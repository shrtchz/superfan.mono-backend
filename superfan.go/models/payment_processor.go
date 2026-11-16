package models

import "time"

type PaymentProcessor struct {
	ID          int        `gorm:"primaryKey;column:id" json:"id"`
	Name        string     `gorm:"column:name" json:"name"`
	PublicKey   *string    `gorm:"column:publicKey" json:"publicKey"`
	SecretKey   *string    `gorm:"column:secretKey" json:"secretKey"`
	IsEnabled   bool       `gorm:"column:isEnabled" json:"isEnabled"`
	IsConnected bool       `gorm:"column:isConnected" json:"isConnected"`
	LastSync    *time.Time `gorm:"column:lastSync" json:"lastSync"`
	CreatedAt   time.Time  `gorm:"column:createdAt" json:"createdAt"`
	UpdatedAt   time.Time  `gorm:"column:updatedAt" json:"updatedAt"`
}

func (PaymentProcessor) TableName() string {
	return "PaymentProcessor"
}
