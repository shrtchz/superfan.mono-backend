package models

import "time"

// YouTubeToken maps exactly to the Prisma schema "YouTubeToken".
type YouTubeToken struct {
	ID           int        `gorm:"primaryKey;column:id" json:"id"`
	Service      string     `gorm:"uniqueIndex;column:service" json:"service"`
	AccessToken  *string    `gorm:"column:accessToken" json:"accessToken"`
	RefreshToken *string    `gorm:"column:refreshToken" json:"refreshToken"`
	ExpiryDate   *time.Time `gorm:"column:expiryDate" json:"expiryDate"`
	Scope        *string    `gorm:"column:scope" json:"scope"`
	TokenType    *string    `gorm:"column:tokenType" json:"tokenType"`
	CreatedAt    time.Time  `gorm:"column:createdAt" json:"createdAt"`
	UpdatedAt    time.Time  `gorm:"column:updatedAt" json:"updatedAt"`
}

// TableName overrides the default GORM table name to match Prisma's generated name.
func (YouTubeToken) TableName() string {
	return "\"YouTubeToken\""
}

// StreamComment maps exactly to the Prisma schema "StreamComment".
type StreamComment struct {
	ID        int       `gorm:"primaryKey;column:id" json:"id"`
	StreamID  string    `gorm:"column:streamId" json:"streamId"`
	UserID    int       `gorm:"column:userId" json:"userId"`
	Comment   string    `gorm:"column:comment" json:"comment"`
	CreatedAt time.Time `gorm:"column:createdAt" json:"createdAt"`
	UpdatedAt time.Time `gorm:"column:updatedAt" json:"updatedAt"`
}

func (StreamComment) TableName() string {
	return "\"StreamComment\""
}
