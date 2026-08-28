package models

import "time"

// ExchangeRate maps to Postgres "exchangeRate" table (Prisma exchangeRate).
type ExchangeRate struct {
	ID           int       `gorm:"column:id;primaryKey" json:"id"`
	FromCurrency string    `gorm:"column:fromCurrency" json:"fromCurrency"`
	ToCurrency   string    `gorm:"column:toCurrency" json:"toCurrency"`
	Rate         float64   `gorm:"column:rate" json:"rate"`
	CreatedAt    time.Time `gorm:"column:createdAt" json:"createdAt"`
	UpdatedAt    time.Time `gorm:"column:updatedAt" json:"updatedAt"`
}

func (ExchangeRate) TableName() string {
	return "exchangeRate"
}
