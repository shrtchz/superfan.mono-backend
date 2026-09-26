package models

import "time"

// User maps to Postgres "User" table (Prisma User).
type User struct {
	ID                 int        `gorm:"column:id;primaryKey" json:"id"`
	FirstName          string     `gorm:"column:firstName" json:"firstName"`
	LastName           string     `gorm:"column:lastName" json:"lastName"`
	Email              string     `gorm:"column:email" json:"email"`
	Username           string     `gorm:"column:username" json:"username"`
	AccountNumber      *string    `gorm:"column:accountNumber" json:"accountNumber"`
	BankCode           *string    `gorm:"column:bankCode" json:"bankCode"`
	SubAccountCode     *string    `gorm:"column:subAccountCode" json:"subAccountCode"`
	LifetimePoints     int        `gorm:"column:lifetime_points" json:"lifetime_points"`
	ProfilePicture     *string    `gorm:"column:profilePicture" json:"profilePicture"`
	ClerkUserID        *string    `gorm:"column:clerkUserId" json:"clerkUserId"`
	RoleName           *string    `gorm:"column:roleName" json:"roleName"`
	SubscriptionPlan   *string    `gorm:"column:subscriptionPlan" json:"subscriptionPlan"`
	LanguagePreference *string    `gorm:"column:languagePreference" json:"languagePreference"`
	SubjectPreference  *string    `gorm:"column:subjectPreference" json:"subjectPreference"`
	TestLevel          *string    `gorm:"column:testLevel" json:"testLevel"`
	DailyStreak        int        `gorm:"column:dailyStreak" json:"dailyStreak"`
	LastStreakDate     *time.Time `gorm:"column:lastStreakDate" json:"lastStreakDate"`
	KycStatus          *string    `gorm:"column:kyc_status;default:UNVERIFIED" json:"kyc_status"`
	KycTier            *string    `gorm:"column:kyc_tier;default:TIER_0" json:"kyc_tier"`
	DiditSessionID     *string    `gorm:"column:didit_session_id" json:"didit_session_id"`
	DiditVerificationID *string   `gorm:"column:didit_verification_id" json:"didit_verification_id"`
	KycRejectionReason *string    `gorm:"column:kyc_rejection_reason" json:"kyc_rejection_reason"`
	KycVerifiedAt      *time.Time `gorm:"column:kyc_verified_at" json:"kyc_verified_at"`
	CreatedAt          time.Time  `gorm:"column:createdAt" json:"createdAt"`
}

func (User) TableName() string {
	return "User"
}
