package models

import (
	"time"

	"github.com/lib/pq"
)

type AdStatus string

const (
	AdStatusPending   AdStatus = "PENDING"
	AdStatusActive    AdStatus = "ACTIVE"
	AdStatusPaused    AdStatus = "PAUSED"
	AdStatusCompleted AdStatus = "COMPLETED"
)

type AdEventType string

const (
	AdEventTypeViewStart        AdEventType = "VIEW_START"
	AdEventTypeCompletion       AdEventType = "COMPLETION"
	AdEventTypeClick            AdEventType = "CLICK"
	AdEventTypeRewardAwarded    AdEventType = "REWARD_AWARDED"
	AdEventTypeRewardSuppressed AdEventType = "REWARD_SUPPRESSED"
)

type PlacementType string

const (
	PlacementQuizAdQ1           PlacementType = "QUIZ_AD_Q1"          // 30s | Non-skippable | CPM
	PlacementMidQuizAd          PlacementType = "MID_QUIZ_AD"         // 15s | Skip after 5s | CPM | 200 PTS award
	PlacementPostQuizAd         PlacementType = "POST_QUIZ_AD"        // 20s | Skip after 5s | CPA
	PlacementPreQuizAd          PlacementType = "PRE_QUIZ_AD"         // 20s | Skip after 5s | CPA
	PlacementSponsoredQuestions PlacementType = "SPONSORED_QUESTIONS" // Blocks of 25 Questions
)

type AdCampaign struct {
	ID              int            `gorm:"column:id;primaryKey;autoIncrement" json:"id"`
	UserID          *int           `gorm:"column:userId" json:"userId,omitempty"`
	Username        *string        `gorm:"column:username" json:"username,omitempty"`
	FullName        *string        `gorm:"-" json:"fullName,omitempty"`
	ProfilePicture  *string        `gorm:"-" json:"profilePicture,omitempty"`
	Headline        string         `gorm:"column:headline" json:"headline"`
	Description     *string        `gorm:"column:description" json:"description,omitempty"`
	ButtonLabel     *string        `gorm:"column:buttonLabel" json:"buttonLabel,omitempty"`
	WebsiteURL      *string        `gorm:"column:websiteUrl" json:"websiteUrl,omitempty"`
	MediaURLs       pq.StringArray `gorm:"column:mediaUrls;type:text[]" json:"mediaUrls"`
	MediaType       *string        `gorm:"column:mediaType" json:"mediaType,omitempty"`
	DailyFee        int            `gorm:"column:dailyFee;default:500" json:"dailyFee"`
	TotalFee        int            `gorm:"column:totalFee" json:"totalFee"`
	Days            int            `gorm:"column:days;default:1" json:"days"`
	StartDate       time.Time      `gorm:"column:startDate" json:"startDate"`
	EndDate         *time.Time     `gorm:"column:endDate" json:"endDate,omitempty"`
	RunContinuously bool           `gorm:"column:runContinuously;default:true" json:"runContinuously"`
	AgeRange        *string        `gorm:"column:ageRange" json:"ageRange,omitempty"`
	PlacementType   *string        `gorm:"column:placementType" json:"placementType,omitempty"`
	PricingModel    *string        `gorm:"column:pricingModel" json:"pricingModel,omitempty"`
	QuestionBlocks  int            `gorm:"column:questionBlocks;default:0" json:"questionBlocks,omitempty"`
	Status          AdStatus       `gorm:"column:status;default:PENDING" json:"status"`
	Views           int            `gorm:"column:views;default:0" json:"views"`
	Clicks          int            `gorm:"column:clicks;default:0" json:"clicks"`
	PaymentStatus   string         `gorm:"column:paymentStatus;default:PENDING" json:"paymentStatus"`
	PaymentRef      *string        `gorm:"column:paymentRef" json:"paymentRef,omitempty"`
	CreatedAt       time.Time      `gorm:"column:createdAt" json:"createdAt"`
	UpdatedAt       time.Time      `gorm:"column:updatedAt" json:"updatedAt"`

	Placements []AdPlacement `gorm:"foreignKey:CampaignID;constraint:OnDelete:CASCADE" json:"placements,omitempty"`
}

func (AdCampaign) TableName() string {
	return "AdCampaign"
}

type AdPlacement struct {
	ID                int           `gorm:"column:id;primaryKey;autoIncrement" json:"id"`
	CampaignID        int           `gorm:"column:campaignId" json:"campaignId"`
	Key               string        `gorm:"column:key" json:"key"` // e.g. "QUIZ_AD_Q1", "MID_QUIZ_AD", "QUIZ_MIDPOINT"
	PlacementType     PlacementType `gorm:"column:placementType" json:"placementType,omitempty"`
	MediaURL          string        `gorm:"column:mediaUrl" json:"mediaUrl"`
	DurationSec       int           `gorm:"column:durationSec;default:30" json:"durationSec"`
	SkipAllowed       bool          `gorm:"column:skipAllowed;default:false" json:"skipAllowed"`
	SkipAfterSec      int           `gorm:"column:skipAfterSec;default:0" json:"skipAfterSec"`
	PointsAwardActive bool          `gorm:"column:pointsAwardActive;default:false" json:"pointsAwardActive"`
	PointsAwardAmount int           `gorm:"column:pointsAwardAmount;default:0" json:"pointsAwardAmount"`
	PricingModel      string        `gorm:"column:pricingModel" json:"pricingModel,omitempty"`
	CreatedAt         time.Time     `gorm:"column:createdAt" json:"createdAt"`
}

func (AdPlacement) TableName() string {
	return "AdPlacement"
}

type AdEvent struct {
	ID          int         `gorm:"column:id;primaryKey;autoIncrement" json:"id"`
	UserID      *int        `gorm:"column:userId" json:"userId,omitempty"`
	CampaignID  *int        `gorm:"column:campaignId" json:"campaignId,omitempty"`
	PlacementID *int        `gorm:"column:placementId" json:"placementId,omitempty"`
	QuizID      *string     `gorm:"column:quizId" json:"quizId,omitempty"`
	EventType   AdEventType `gorm:"column:eventType" json:"eventType"`
	PointsGiven int         `gorm:"column:pointsGiven;default:0" json:"pointsGiven,omitempty"`
	CreatedAt   time.Time   `gorm:"column:createdAt" json:"createdAt"`
}

func (AdEvent) TableName() string {
	return "AdEvent"
}
