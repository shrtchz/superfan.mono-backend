package middleware

import (
	"crypto/rsa"
	"encoding/base64"
	"encoding/json"
	"fmt"
	"log"
	"math/big"
	"net/http"
	"strings"
	"sync"
	"time"

	"github.com/golang-jwt/jwt/v5"
	"quiz.superfan.com/apis/utils"
)

type clerkJWKS struct {
	Keys []clerkJWK `json:"keys"`
}

type clerkJWK struct {
	Kid string `json:"kid"`
	Kty string `json:"kty"`
	Alg string `json:"alg"`
	N   string `json:"n"`
	E   string `json:"e"`
}

type jwksSource struct {
	url    string
	bearer string
}

type cachedJWKS struct {
	jwks *clerkJWKS
	at   time.Time
}

var (
	jwksCacheMu       sync.Mutex
	jwksCache         = map[string]cachedJWKS{}
	jwksCacheTTL      = 1 * time.Hour
	lastVerifyFailLog time.Time
)

// verifyClerkToken validates a Clerk session JWT against every configured Clerk JWKS.
func verifyClerkToken(tokenString string) (jwt.MapClaims, bool) {
	unverified, _, err := jwt.NewParser().ParseUnverified(tokenString, jwt.MapClaims{})
	if err != nil {
		return nil, false
	}

	kid, _ := unverified.Header["kid"].(string)
	if kid == "" {
		logClerkVerifyFailure("token has no kid header", "")
		return nil, false
	}

	sources := clerkJWKSSources()
	if len(sources) == 0 {
		logClerkVerifyFailure("no Clerk JWKS source configured; set CLERK_JWKS_URL, CLERK_ISSUER, CLERK_FRONTEND_API, or a Clerk publishable key", kid)
		return nil, false
	}

	var lastErr error
	for _, src := range sources {
		jwks, err := getClerkJWKS(src, false)
		if err != nil {
			lastErr = err
			continue
		}
		key := findJWK(jwks, kid)
		if key == nil {
			// Key id missing from cache — refetch once in case Clerk rotated keys.
			if jwks, err = getClerkJWKS(src, true); err != nil {
				lastErr = err
				continue
			}
			key = findJWK(jwks, kid)
		}
		if key == nil {
			continue
		}

		pubKey, err := jwkToRSAPublicKey(key)
		if err != nil {
			lastErr = err
			continue
		}

		claims := jwt.MapClaims{}
		parsed, err := jwt.ParseWithClaims(tokenString, claims, func(t *jwt.Token) (interface{}, error) {
			if t.Method == nil || t.Method.Alg() != jwt.SigningMethodRS256.Alg() {
				return nil, jwt.ErrTokenSignatureInvalid
			}
			return pubKey, nil
		}, jwt.WithLeeway(5*time.Minute))
		if err != nil || !parsed.Valid {
			lastErr = err
			continue
		}

		sub, _ := claims["sub"].(string)
		if sub == "" {
			lastErr = fmt.Errorf("token has no sub claim")
			continue
		}
		return claims, true
	}

	msg := "kid not found or signature invalid in any configured Clerk JWKS"
	if lastErr != nil {
		msg = fmt.Sprintf("%s (last error: %v)", msg, lastErr)
	}
	logClerkVerifyFailure(msg, kid)
	return nil, false
}

func findJWK(jwks *clerkJWKS, kid string) *clerkJWK {
	for i := range jwks.Keys {
		if jwks.Keys[i].Kid == kid {
			return &jwks.Keys[i]
		}
	}
	return nil
}

// logClerkVerifyFailure logs verification failures (throttled) with the JWKS sources in use.
func logClerkVerifyFailure(reason, kid string) {
	jwksCacheMu.Lock()
	if time.Since(lastVerifyFailLog) < 30*time.Second {
		jwksCacheMu.Unlock()
		return
	}
	lastVerifyFailLog = time.Now()
	jwksCacheMu.Unlock()

	urls := make([]string, 0, 4)
	for _, src := range clerkJWKSSources() {
		urls = append(urls, src.url)
	}
	log.Printf("[AUTH] Clerk token verification failed: %s (kid=%s, jwks sources=%v)", reason, kid, urls)
}

// clerkJWKSSources returns the configured Clerk JWKS endpoints in priority order.
func clerkJWKSSources() []jwksSource {
	var sources []jwksSource
	seen := map[string]bool{}

	add := func(rawURL, bearer string) {
		rawURL = strings.TrimSpace(rawURL)
		if rawURL == "" {
			return
		}
		if !strings.HasPrefix(rawURL, "http") {
			rawURL = "https://" + rawURL
		}
		rawURL = strings.TrimRight(rawURL, "/")
		if seen[rawURL] {
			return
		}
		seen[rawURL] = true
		sources = append(sources, jwksSource{url: rawURL, bearer: bearer})
	}

	add(utils.GetEnvWithKey("CLERK_JWKS_URL"), "")

	issuers := []string{
		utils.GetEnvWithKey("CLERK_ISSUER"),
		utils.GetEnvWithKey("CLERK_FRONTEND_API"),
		// Derive Frontend API host from publishable key (pk_test_<base64(host$)>)
		clerkFrontendAPIFromPublishableKey(utils.GetEnvWithKey("CLERK_PUBLISHABLE_KEY")),
		clerkFrontendAPIFromPublishableKey(utils.GetEnvWithKey("NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY")),
	}
	for _, issuer := range issuers {
		issuer = strings.TrimSpace(issuer)
		if issuer == "" {
			continue
		}
		if !strings.HasPrefix(issuer, "http") {
			issuer = "https://" + issuer
		}
		issuer = strings.TrimRight(issuer, "/")
		// Session JWTs are verified against the Frontend API JWKS (same as Nest verifyToken).
		add(issuer+"/.well-known/jwks.json", "")
	}

	if secretKey := utils.GetEnvWithKey("CLERK_SECRET_KEY"); secretKey != "" {
		// Last resort — Backend API JWKS (may not match session token kids)
		add("https://api.clerk.com/v1/jwks", secretKey)
	}

	return sources
}

func getClerkJWKS(src jwksSource, force bool) (*clerkJWKS, error) {
	jwksCacheMu.Lock()
	if !force {
		if cached, ok := jwksCache[src.url]; ok && time.Since(cached.at) < jwksCacheTTL {
			jwksCacheMu.Unlock()
			return cached.jwks, nil
		}
	}
	jwksCacheMu.Unlock()

	req, err := http.NewRequest(http.MethodGet, src.url, nil)
	if err != nil {
		return nil, err
	}
	if src.bearer != "" {
		req.Header.Set("Authorization", "Bearer "+src.bearer)
	}

	client := &http.Client{Timeout: 10 * time.Second}
	resp, err := client.Do(req)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		return nil, fmt.Errorf("failed to fetch Clerk JWKS from %s: status %d", src.url, resp.StatusCode)
	}

	var jwks clerkJWKS
	if err := json.NewDecoder(resp.Body).Decode(&jwks); err != nil {
		return nil, err
	}

	jwksCacheMu.Lock()
	jwksCache[src.url] = cachedJWKS{jwks: &jwks, at: time.Now()}
	jwksCacheMu.Unlock()

	return &jwks, nil
}

// clerkFrontendAPIFromPublishableKey decodes pk_(test|live)_<base64> → https://<host>
func clerkFrontendAPIFromPublishableKey(publishableKey string) string {
	publishableKey = strings.TrimSpace(publishableKey)
	if publishableKey == "" {
		return ""
	}
	parts := strings.SplitN(publishableKey, "_", 3)
	if len(parts) < 3 {
		return ""
	}
	encoded := parts[2]
	decoded, err := base64.RawStdEncoding.DecodeString(encoded)
	if err != nil {
		decoded, err = base64.StdEncoding.DecodeString(encoded)
		if err != nil {
			return ""
		}
	}
	host := strings.TrimSuffix(string(decoded), "$")
	host = strings.TrimSpace(host)
	if host == "" {
		return ""
	}
	if strings.HasPrefix(host, "http") {
		return host
	}
	return "https://" + host
}

func jwkToRSAPublicKey(jwk *clerkJWK) (*rsa.PublicKey, error) {
	nBytes, err := base64.RawURLEncoding.DecodeString(jwk.N)
	if err != nil {
		return nil, err
	}
	eBytes, err := base64.RawURLEncoding.DecodeString(jwk.E)
	if err != nil {
		return nil, err
	}

	n := new(big.Int).SetBytes(nBytes)
	var eInt int
	for _, b := range eBytes {
		eInt = eInt<<8 + int(b)
	}
	if eInt == 0 {
		eInt = 65537
	}
	return &rsa.PublicKey{N: n, E: eInt}, nil
}
