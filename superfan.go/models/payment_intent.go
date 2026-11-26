package models

import "time"

// PaymentIntent tracks an initiated payment before and after provider settlement,
// ensuring business fulfillment and idempotency across synchronous and async flows.
type PaymentIntent struct {
	ID         int       `gorm:"column:id;primaryKey" json:"id"`
	UserID     int       `gorm:"column:userId;index" json:"userId"`
	Reference  string    `gorm:"column:reference;uniqueIndex;size:128" json:"reference"`
	Purpose    string    `gorm:"column:purpose;size:64" json:"purpose"`
	TargetType *string   `gorm:"column:targetType;size:64" json:"targetType,omitempty"`
	TargetID   *string   `gorm:"column:targetId;size:128" json:"targetId,omitempty"`
	Amount     float64   `gorm:"column:amount" json:"amount"`
	Currency   string    `gorm:"column:currency;size:16;default:NGN" json:"currency"`
	Status     string    `gorm:"column:status;size:32;default:PENDING_PAYMENT" json:"status"`
	Metadata   *string   `gorm:"column:metadata;type:text" json:"metadata,omitempty"`
	CreatedAt  time.Time `gorm:"column:createdAt" json:"createdAt"`
	UpdatedAt  time.Time `gorm:"column:updatedAt" json:"updatedAt"`
}

func (PaymentIntent) TableName() string {
	return "PaymentIntent"
}
