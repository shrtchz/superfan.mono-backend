package middleware

import (
	"crypto/rsa"
	"encoding/base64"
	"encoding/json"
	"fmt"
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

var (
	jwksCache     *clerkJWKS
	jwksCacheAt   time.Time
	jwksCacheMu   sync.Mutex
	jwksCacheTTL  = 1 * time.Hour
)

// verifyClerkToken validates a Clerk session JWT against Clerk's JWKS.
func verifyClerkToken(tokenString string) (jwt.MapClaims, bool) {
	unverified, _, err := jwt.NewParser().ParseUnverified(tokenString, jwt.MapClaims{})
	if err != nil {
		return nil, false
	}

	kid, _ := unverified.Header["kid"].(string)
	if kid == "" {
		return nil, false
	}

	jwks, err := getClerkJWKS()
	if err != nil || jwks == nil {
		return nil, false
	}

	var matched *clerkJWK
	for i := range jwks.Keys {
		if jwks.Keys[i].Kid == kid {
			matched = &jwks.Keys[i]
			break
		}
	}
	if matched == nil {
		return nil, false
	}

	pubKey, err := jwkToRSAPublicKey(matched)
	if err != nil {
		return nil, false
	}

	claims := jwt.MapClaims{}
	parsed, err := jwt.ParseWithClaims(tokenString, claims, func(t *jwt.Token) (interface{}, error) {
		if t.Method == nil || t.Method.Alg() != jwt.SigningMethodRS256.Alg() {
			return nil, jwt.ErrTokenSignatureInvalid
		}
		return pubKey, nil
	}, jwt.WithLeeway(5*time.Minute))
	if err != nil || !parsed.Valid {
		return nil, false
	}

	sub, _ := claims["sub"].(string)
	if sub == "" {
		return nil, false
	}
	return claims, true
}

func getClerkJWKS() (*clerkJWKS, error) {
	jwksCacheMu.Lock()
	defer jwksCacheMu.Unlock()

	if jwksCache != nil && time.Since(jwksCacheAt) < jwksCacheTTL {
		return jwksCache, nil
	}

	jwksURL := utils.GetEnvWithKey("CLERK_JWKS_URL")
	secretKey := utils.GetEnvWithKey("CLERK_SECRET_KEY")

	if jwksURL == "" {
		issuer := utils.GetEnvWithKey("CLERK_ISSUER")
		if issuer == "" {
			issuer = utils.GetEnvWithKey("CLERK_FRONTEND_API")
		}
		// Derive Frontend API host from publishable key (pk_test_<base64(host$)>)
		if issuer == "" {
			issuer = clerkFrontendAPIFromPublishableKey(
				utils.GetEnvWithKey("CLERK_PUBLISHABLE_KEY"),
			)
			if issuer == "" {
				issuer = clerkFrontendAPIFromPublishableKey(
					utils.GetEnvWithKey("NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY"),
				)
			}
		}
		if issuer != "" {
			issuer = strings.TrimRight(issuer, "/")
			if !strings.HasPrefix(issuer, "http") {
				issuer = "https://" + issuer
			}
			// Session JWTs are verified against the Frontend API JWKS (same as Nest verifyToken).
			jwksURL = issuer + "/.well-known/jwks.json"
		} else if secretKey != "" {
			// Last resort — Backend API JWKS (may not match session token kids)
			jwksURL = "https://api.clerk.com/v1/jwks"
		} else {
			return nil, fmt.Errorf("CLERK_JWKS_URL, CLERK_ISSUER/CLERK_FRONTEND_API, or CLERK_SECRET_KEY is required")
		}
	}

	req, err := http.NewRequest(http.MethodGet, jwksURL, nil)
	if err != nil {
		return nil, err
	}
	if strings.Contains(jwksURL, "api.clerk.com") && secretKey != "" {
		req.Header.Set("Authorization", "Bearer "+secretKey)
	}

	client := &http.Client{Timeout: 10 * time.Second}
	resp, err := client.Do(req)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		return nil, fmt.Errorf("failed to fetch Clerk JWKS: status %d", resp.StatusCode)
	}

	var jwks clerkJWKS
	if err := json.NewDecoder(resp.Body).Decode(&jwks); err != nil {
		return nil, err
	}
	jwksCache = &jwks
	jwksCacheAt = time.Now()
	return jwksCache, nil
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
