package models

import (
	"strings"
	"time"
)

type PaymentProcessor struct {
	ID               int                    `gorm:"primaryKey;column:id" json:"id"`
	Name             string                 `gorm:"column:name" json:"name"`
	PublicKey        *string                `gorm:"column:publicKey" json:"publicKey"`
	SecretKey        *string                `gorm:"column:secretKey" json:"secretKey"`
	AdditionalFields map[string]interface{} `gorm:"column:additionalFields;type:jsonb;serializer:json" json:"additionalFields"`
	IsEnabled        bool                   `gorm:"column:isEnabled" json:"isEnabled"`
	IsConnected      bool                   `gorm:"column:isConnected" json:"isConnected"`
	LastSync         *time.Time             `gorm:"column:lastSync" json:"lastSync"`
	CreatedAt        time.Time              `gorm:"column:createdAt" json:"createdAt"`
	UpdatedAt        time.Time              `gorm:"column:updatedAt" json:"updatedAt"`
}

// AdditionalField returns the trimmed string value for a custom processor field.
func (p *PaymentProcessor) AdditionalField(key string) string {
	if p == nil || p.AdditionalFields == nil {
		return ""
	}
	value, ok := p.AdditionalFields[key]
	if !ok {
		return ""
	}
	str, ok := value.(string)
	if !ok {
		return ""
	}
	return strings.TrimSpace(str)
}

func (PaymentProcessor) TableName() string {
	return "PaymentProcessor"
}
