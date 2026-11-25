package middleware

import "testing"

func TestClerkJWKSSources_DerivesFromPublishableKey(t *testing.T) {
	t.Setenv("CLERK_JWKS_URL", "")
	t.Setenv("CLERK_ISSUER", "")
	t.Setenv("CLERK_FRONTEND_API", "")
	t.Setenv("CLERK_PUBLISHABLE_KEY", "")
	t.Setenv("CLERK_SECRET_KEY", "")
	t.Setenv("NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY", "pk_test_cXVpY2stamVubmV0LTMuY2xlcmsuYWNjb3VudHMuZGV2JA")

	sources := clerkJWKSSources()
	if len(sources) != 1 {
		t.Fatalf("expected 1 source, got %d: %+v", len(sources), sources)
	}
	want := "https://quick-jennet-3.clerk.accounts.dev/.well-known/jwks.json"
	if sources[0].url != want {
		t.Fatalf("expected %q, got %q", want, sources[0].url)
	}
}

func TestClerkJWKSSources_Dedupes(t *testing.T) {
	t.Setenv("CLERK_JWKS_URL", "")
	t.Setenv("CLERK_SECRET_KEY", "")
	t.Setenv("CLERK_PUBLISHABLE_KEY", "")
	t.Setenv("CLERK_ISSUER", "")
	t.Setenv("CLERK_FRONTEND_API", "https://quick-jennet-3.clerk.accounts.dev/")
	t.Setenv("NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY", "pk_test_cXVpY2stamVubmV0LTMuY2xlcmsuYWNjb3VudHMuZGV2JA")

	sources := clerkJWKSSources()
	if len(sources) != 1 {
		t.Fatalf("expected deduped single source, got %d: %+v", len(sources), sources)
	}
}

func TestClerkJWKSSources_ExplicitURLFirst(t *testing.T) {
	t.Setenv("CLERK_JWKS_URL", "https://example.clerk.accounts.dev/.well-known/jwks.json/")
	t.Setenv("CLERK_SECRET_KEY", "sk_test_x")
	t.Setenv("CLERK_PUBLISHABLE_KEY", "")
	t.Setenv("CLERK_ISSUER", "")
	t.Setenv("CLERK_FRONTEND_API", "")
	t.Setenv("NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY", "")

	sources := clerkJWKSSources()
	if len(sources) != 2 {
		t.Fatalf("expected explicit + backend sources, got %d: %+v", len(sources), sources)
	}
	if sources[0].url != "https://example.clerk.accounts.dev/.well-known/jwks.json" {
		t.Fatalf("expected trailing slash trimmed, got %q", sources[0].url)
	}
	if sources[1].url != "https://api.clerk.com/v1/jwks" || sources[1].bearer != "sk_test_x" {
		t.Fatalf("expected backend JWKS with bearer, got %+v", sources[1])
	}
}
