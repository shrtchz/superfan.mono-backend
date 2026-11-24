package providers

import (
	"os"
	"testing"
)

func clearEnv(keys ...string) func() {
	original := make(map[string]string)
	for _, k := range keys {
		original[k] = os.Getenv(k)
		os.Unsetenv(k)
	}
	return func() {
		for k, v := range original {
			if v != "" {
				os.Setenv(k, v)
			} else {
				os.Unsetenv(k)
			}
		}
	}
}

func TestResolveMonnifyContractCode_StagingFlag(t *testing.T) {
	restore := clearEnv(
		"MONNIFY_ENV", "MONNIFY_STAGE", "MONNIFY_CONTRACT_ENV", "MONNIFY_MODE",
		"USE_PROD_MONNIFY_CONTRACT", "USE_PROD_MONNIFY", "PROD_MONNIFY_CONTRACT",
		"STAGE", "APP_ENV", "ENVIRONMENT", "NODE_ENV",
		"MONNIFY_CONTRACT_CODE", "PROD_MONNIFY_CONTRACT_CODE",
		"MONNIFY_API_KEY", "PROD_MONNIFY_API_KEY",
	)
	defer restore()

	os.Setenv("MONNIFY_CONTRACT_CODE", "staging_contract_111")
	os.Setenv("PROD_MONNIFY_CONTRACT_CODE", "prod_contract_222")

	// Set staging flag
	os.Setenv("MONNIFY_ENV", "staging")

	got := ResolveMonnifyContractCode()
	if got != "staging_contract_111" {
		t.Errorf("expected staging_contract_111 with MONNIFY_ENV=staging, got %s", got)
	}
}

func TestResolveMonnifyContractCode_ProductionFlag(t *testing.T) {
	restore := clearEnv(
		"MONNIFY_ENV", "MONNIFY_STAGE", "MONNIFY_CONTRACT_ENV", "MONNIFY_MODE",
		"USE_PROD_MONNIFY_CONTRACT", "USE_PROD_MONNIFY", "PROD_MONNIFY_CONTRACT",
		"STAGE", "APP_ENV", "ENVIRONMENT", "NODE_ENV",
		"MONNIFY_CONTRACT_CODE", "PROD_MONNIFY_CONTRACT_CODE",
		"MONNIFY_API_KEY", "PROD_MONNIFY_API_KEY",
	)
	defer restore()

	os.Setenv("MONNIFY_CONTRACT_CODE", "staging_contract_111")
	os.Setenv("PROD_MONNIFY_CONTRACT_CODE", "prod_contract_222")

	// Set production flag
	os.Setenv("MONNIFY_ENV", "production")

	got := ResolveMonnifyContractCode()
	if got != "prod_contract_222" {
		t.Errorf("expected prod_contract_222 with MONNIFY_ENV=production, got %s", got)
	}
}

func TestResolveMonnifyContractCode_AlternativeStageFlags(t *testing.T) {
	restore := clearEnv(
		"MONNIFY_ENV", "MONNIFY_STAGE", "MONNIFY_CONTRACT_ENV", "MONNIFY_MODE",
		"USE_PROD_MONNIFY_CONTRACT", "USE_PROD_MONNIFY", "PROD_MONNIFY_CONTRACT",
		"STAGE", "APP_ENV", "ENVIRONMENT", "NODE_ENV",
		"MONNIFY_CONTRACT_CODE", "PROD_MONNIFY_CONTRACT_CODE",
		"MONNIFY_API_KEY", "PROD_MONNIFY_API_KEY",
	)
	defer restore()

	os.Setenv("MONNIFY_CONTRACT_CODE", "staging_contract_111")
	os.Setenv("PROD_MONNIFY_CONTRACT_CODE", "prod_contract_222")

	testCases := []struct {
		envKey   string
		envVal   string
		expected string
	}{
		{"MONNIFY_STAGE", "staging", "staging_contract_111"},
		{"MONNIFY_STAGE", "production", "prod_contract_222"},
		{"MONNIFY_CONTRACT_ENV", "staging", "staging_contract_111"},
		{"MONNIFY_CONTRACT_ENV", "prod", "prod_contract_222"},
		{"USE_PROD_MONNIFY_CONTRACT", "false", "staging_contract_111"},
		{"USE_PROD_MONNIFY_CONTRACT", "true", "prod_contract_222"},
		{"STAGE", "staging", "staging_contract_111"},
		{"STAGE", "production", "prod_contract_222"},
		{"APP_ENV", "staging", "staging_contract_111"},
		{"APP_ENV", "production", "prod_contract_222"},
		{"ENVIRONMENT", "staging", "staging_contract_111"},
		{"ENVIRONMENT", "production", "prod_contract_222"},
		{"NODE_ENV", "staging", "staging_contract_111"},
		{"NODE_ENV", "production", "prod_contract_222"},
	}

	for _, tc := range testCases {
		os.Setenv(tc.envKey, tc.envVal)
		got := ResolveMonnifyContractCode()
		os.Unsetenv(tc.envKey)

		if got != tc.expected {
			t.Errorf("failed for %s=%s: expected %s, got %s", tc.envKey, tc.envVal, tc.expected, got)
		}
	}
}

func TestResolveMonnifyContractCode_TestApiKey(t *testing.T) {
	restore := clearEnv(
		"MONNIFY_ENV", "MONNIFY_STAGE", "MONNIFY_CONTRACT_ENV", "MONNIFY_MODE",
		"USE_PROD_MONNIFY_CONTRACT", "USE_PROD_MONNIFY", "PROD_MONNIFY_CONTRACT",
		"STAGE", "APP_ENV", "ENVIRONMENT", "NODE_ENV",
		"MONNIFY_CONTRACT_CODE", "PROD_MONNIFY_CONTRACT_CODE",
		"MONNIFY_API_KEY", "PROD_MONNIFY_API_KEY",
	)
	defer restore()

	os.Setenv("MONNIFY_CONTRACT_CODE", "staging_contract_111")
	os.Setenv("PROD_MONNIFY_CONTRACT_CODE", "prod_contract_222")

	// Pass MK_TEST_ API key directly
	got := ResolveMonnifyContractCode("MK_TEST_12345")
	if got != "staging_contract_111" {
		t.Errorf("expected staging_contract_111 with MK_TEST_ key, got %s", got)
	}

	// Pass MK_PROD_ API key directly
	gotProd := ResolveMonnifyContractCode("MK_PROD_67890")
	if gotProd != "prod_contract_222" {
		t.Errorf("expected prod_contract_222 with MK_PROD_ key, got %s", gotProd)
	}
}

func TestResolveMonnifyContractCode_DefaultFallback(t *testing.T) {
	restore := clearEnv(
		"MONNIFY_ENV", "MONNIFY_STAGE", "MONNIFY_CONTRACT_ENV", "MONNIFY_MODE",
		"USE_PROD_MONNIFY_CONTRACT", "USE_PROD_MONNIFY", "PROD_MONNIFY_CONTRACT",
		"STAGE", "APP_ENV", "ENVIRONMENT", "NODE_ENV",
		"MONNIFY_CONTRACT_CODE", "PROD_MONNIFY_CONTRACT_CODE",
		"MONNIFY_API_KEY", "PROD_MONNIFY_API_KEY",
	)
	defer restore()

	// 1. Both set: defaults to prod
	os.Setenv("MONNIFY_CONTRACT_CODE", "staging_contract_111")
	os.Setenv("PROD_MONNIFY_CONTRACT_CODE", "prod_contract_222")
	if got := ResolveMonnifyContractCode(); got != "prod_contract_222" {
		t.Errorf("expected default to prod_contract_222, got %s", got)
	}

	// 2. Only staging set: falls back to staging
	os.Unsetenv("PROD_MONNIFY_CONTRACT_CODE")
	if got := ResolveMonnifyContractCode(); got != "staging_contract_111" {
		t.Errorf("expected fallback to staging_contract_111, got %s", got)
	}

	// 3. Neither set: falls back to hardcoded default
	os.Unsetenv("MONNIFY_CONTRACT_CODE")
	if got := ResolveMonnifyContractCode(); got != "943294313374" {
		t.Errorf("expected fallback to 943294313374, got %s", got)
	}
}

func TestNewMonnifyProvider_Resolution(t *testing.T) {
	restore := clearEnv(
		"MONNIFY_ENV", "MONNIFY_STAGE", "MONNIFY_CONTRACT_ENV",
		"MONNIFY_CONTRACT_CODE", "PROD_MONNIFY_CONTRACT_CODE",
	)
	defer restore()

	os.Setenv("MONNIFY_CONTRACT_CODE", "staging_contract_111")
	os.Setenv("PROD_MONNIFY_CONTRACT_CODE", "prod_contract_222")
	os.Setenv("MONNIFY_ENV", "staging")

	// When contractCode is empty, NewMonnifyProvider resolves it via flag
	prov := NewMonnifyProvider("MK_TEST_123", "secret", "https://sandbox.monnify.com", "")
	if prov.ContractCode != "staging_contract_111" {
		t.Errorf("expected prov.ContractCode = staging_contract_111, got %s", prov.ContractCode)
	}

	// When explicit contractCode is passed, it is respected
	provExplicit := NewMonnifyProvider("MK_TEST_123", "secret", "https://sandbox.monnify.com", "custom_999")
	if provExplicit.ContractCode != "custom_999" {
		t.Errorf("expected provExplicit.ContractCode = custom_999, got %s", provExplicit.ContractCode)
	}
}
