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

func TestResolveMonnifyContractCode(t *testing.T) {
	restore := clearEnv("MONNIFY_CONTRACT_CODE", "PROD_MONNIFY_CONTRACT_CODE")
	defer restore()

	os.Setenv("MONNIFY_CONTRACT_CODE", "contract_111")
	os.Setenv("PROD_MONNIFY_CONTRACT_CODE", "prod_contract_222")
	if got := ResolveMonnifyContractCode(); got != "contract_111" {
		t.Errorf("expected contract_111, got %s", got)
	}

	os.Unsetenv("MONNIFY_CONTRACT_CODE")
	if got := ResolveMonnifyContractCode(); got != "prod_contract_222" {
		t.Errorf("expected fallback to prod_contract_222, got %s", got)
	}

	os.Unsetenv("PROD_MONNIFY_CONTRACT_CODE")
	if got := ResolveMonnifyContractCode(); got != "" {
		t.Errorf("expected empty string when unset, got %s", got)
	}
}

func TestNewMonnifyProvider_Resolution(t *testing.T) {
	restore := clearEnv("MONNIFY_CONTRACT_CODE", "PROD_MONNIFY_CONTRACT_CODE")
	defer restore()

	os.Setenv("MONNIFY_CONTRACT_CODE", "contract_111")

	prov := NewMonnifyProvider("MK_TEST_123", "secret", "https://sandbox.monnify.com", "")
	if prov.ContractCode != "contract_111" {
		t.Errorf("expected prov.ContractCode = contract_111, got %s", prov.ContractCode)
	}

	provExplicit := NewMonnifyProvider("MK_TEST_123", "secret", "https://sandbox.monnify.com", "custom_999")
	if provExplicit.ContractCode != "custom_999" {
		t.Errorf("expected provExplicit.ContractCode = custom_999, got %s", provExplicit.ContractCode)
	}
}
