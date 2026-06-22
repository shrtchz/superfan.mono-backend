package utils

import (
	"log"
	"os"
	"path/filepath"

	"github.com/joho/godotenv"
)

// GetEnvWithKey : get env value
func GetEnvWithKey(key string) string {
	return os.Getenv(key)
}

// LoadEnv initially load env
func LoadEnv() {
	wd, err := os.Getwd()
	if err != nil {
		log.Printf("Warning: unable to determine working directory: %v", err)
		return
	}

	envPath := findEnvFile(wd)
	if envPath == "" {
		log.Printf("Warning: .env file not found")
		return
	}

	if err := godotenv.Load(envPath); err != nil {
		log.Printf("Warning: failed to load .env from %s: %v", envPath, err)
		return
	}

	log.Printf(".env loaded successfully from %s", envPath)
}

func findEnvFile(dir string) string {
	for {
		candidate := filepath.Join(dir, ".env")
		if _, err := os.Stat(candidate); err == nil {
			return candidate
		}

		parent := filepath.Dir(dir)
		if parent == dir {
			return ""
		}
		dir = parent
	}
}
