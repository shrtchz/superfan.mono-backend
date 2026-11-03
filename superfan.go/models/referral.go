package models

import "time"

type Referral struct {
	ID                int       `gorm:"column:id;primaryKey" json:"id"`
	ReferrerID        int       `gorm:"column:referrerId" json:"referrerId"`
	RefereeID         int       `gorm:"column:refereeId" json:"refereeId"`
	Status            string    `gorm:"column:status" json:"status"`
	SignupRewardGiven bool      `gorm:"column:signupRewardGiven" json:"signupRewardGiven"`
	TestRewardGiven   bool      `gorm:"column:testRewardGiven" json:"testRewardGiven"`
	CreatedAt         time.Time `gorm:"column:createdAt" json:"createdAt"`
}

func (Referral) TableName() string {
	return "Referral"
}
