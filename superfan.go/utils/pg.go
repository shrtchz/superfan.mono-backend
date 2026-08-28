package utils

import (
	"log"
	"os"
	"time"

	"gorm.io/driver/postgres"
	"gorm.io/gorm"
	"gorm.io/gorm/logger"
)

var DB *gorm.DB

// ConnectPostgres connects to the PostgreSQL database using the provided DATABASE_URL
func ConnectPostgres(dsn string) {
	var err error

	newLogger := logger.New(
		log.New(os.Stdout, "\r\n", log.LstdFlags),
		logger.Config{
			SlowThreshold:             1 * time.Second, // Prevents false-positive SLOW SQL warnings during startup schema reflection (~200-250ms)
			LogLevel:                  logger.Warn,
			IgnoreRecordNotFoundError: true,
			Colorful:                  true,
		},
	)

	DB, err = gorm.Open(postgres.New(postgres.Config{
		DSN:                  dsn,
		PreferSimpleProtocol: true, // Prevents prepared statement name collisions (SQLSTATE 08P01)
	}), &gorm.Config{
		Logger:      newLogger,
		PrepareStmt: false,
	})
	if err != nil {
		log.Fatalf("Failed to connect to PostgreSQL database: %v", err)
	}

	log.Println("PostgreSQL connection established successfully")
}
