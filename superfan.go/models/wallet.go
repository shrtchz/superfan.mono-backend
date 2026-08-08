package models

import "time"

type Wallet struct {
	ID              int     `gorm:"column:id;primaryKey" json:"id"`
	UserID          int     `gorm:"column:userId;uniqueIndex" json:"userId"`
	Balance         float64 `gorm:"column:balance" json:"balance"`
	GoldBalance     float64 `gorm:"column:goldBalance" json:"goldBalance"`
	PersonalBalance float64 `gorm:"column:personalBalance" json:"personalBalance"`
	UsdcBalance     float64 `gorm:"column:usdcBalance" json:"usdcBalance"`
	UsdtBalance     float64 `gorm:"column:usdtBalance" json:"usdtBalance"`
}

func (Wallet) TableName() string {
	return "Wallet"
}

type WalletTransaction struct {
	ID             int        `gorm:"column:id;primaryKey" json:"id"`
	UserID         int        `gorm:"column:userId" json:"userId"`
	Amount         float64    `gorm:"column:amount" json:"amount"`
	Type           *string    `gorm:"column:type" json:"type"`
	Currency       string     `gorm:"column:currency;default:NGN" json:"currency"`
	Username       *string    `gorm:"column:username" json:"username"`
	AccountName    *string    `gorm:"column:account_name" json:"account_name"`
	PaymentMethod  *string    `gorm:"column:payment_method" json:"payment_method"`
	BankName       *string    `gorm:"column:bank_name" json:"bank_name"`
	CardToken      *string    `gorm:"column:cardToken" json:"cardToken"`
	WalletAddress  *string    `gorm:"column:wallet_address" json:"wallet_address"`
	AccountNo      *string    `gorm:"column:account_no" json:"account_no"`
	AccountType    *string    `gorm:"column:account_type" json:"account_type"`
	SettlementDate *time.Time `gorm:"column:settlement_date" json:"settlement_date"`
	Reference      *string    `gorm:"column:reference" json:"reference"`
	Status         *string    `gorm:"column:status" json:"status"`
	TotalEarnings  *float64   `gorm:"column:total_earnings" json:"total_earnings"`
	Payouts        *float64   `gorm:"column:payouts" json:"payouts"`
	LastPayout     *time.Time `gorm:"column:last_payout" json:"last_payout"`
	PaymentDate    *time.Time `gorm:"column:payment_date" json:"payment_date"`
	PendingBalance *float64   `gorm:"column:pending_balance" json:"pending_balance"`
	RewardType     *string    `gorm:"column:rewardType" json:"rewardType"`
	TransactionType *string   `gorm:"column:transactionType" json:"transactionType"`
	Description    *string    `gorm:"column:description" json:"description"`
	TrxRef         *string    `gorm:"column:trx_ref" json:"trx_ref"`
	WalletID       *int       `gorm:"column:walletId" json:"walletId"`
	CreatedAt      time.Time  `gorm:"column:createdAt" json:"createdAt"`
}

func (WalletTransaction) TableName() string {
	return "WalletTransaction"
}

type Reward struct {
	ID        string    `gorm:"column:id;primaryKey" json:"id"`
	UserID    int       `gorm:"column:userId" json:"userId"`
	Amount    int       `gorm:"column:amount" json:"amount"`
	Currency  string    `gorm:"column:currency" json:"currency"`
	Type      string    `gorm:"column:type" json:"type"`
	Status    string    `gorm:"column:status" json:"status"`
	CreatedAt time.Time `gorm:"column:createdAt" json:"createdAt"`
}

func (Reward) TableName() string {
	return "Reward"
}

type Point struct {
	ID        string    `gorm:"column:id;primaryKey" json:"id"`
	UserID    int       `gorm:"column:userId" json:"userId"`
	Points    int       `gorm:"column:points" json:"points"`
	Reference *string   `gorm:"column:reference" json:"reference"`
	Type      string    `gorm:"column:type" json:"type"`
	CreatedAt time.Time `gorm:"column:createdAt" json:"createdAt"`
}

func (Point) TableName() string {
	return "Point"
}

type QuizLeaderboard struct {
	ID             int       `gorm:"column:id;primaryKey" json:"id"`
	UserID         string    `gorm:"column:userId" json:"userId"`
	QuizID         string    `gorm:"column:quizId" json:"quizId"`
	Subject        string    `gorm:"column:subject" json:"subject"`
	TestLevel      string    `gorm:"column:testLevel" json:"testLevel"`
	Score          *int      `gorm:"column:score" json:"score"`
	SelectedAnswer string    `gorm:"column:selectedAnswer" json:"selectedAnswer"`
	QuizTime       *string   `gorm:"column:quizTime" json:"quizTime"`
	AccuracyBonus  *string   `gorm:"column:accuracyBonus" json:"accuracyBonus"`
	CorrectAnswer  string    `gorm:"column:correctAnswer" json:"correctAnswer"`
	Earning        int       `gorm:"column:earning" json:"earning"`
	SubmittedAt    time.Time `gorm:"column:submittedAt" json:"submittedAt"`
	CreatedAt      time.Time `gorm:"column:createdAt" json:"createdAt"`
	UpdatedAt      time.Time `gorm:"column:updatedAt" json:"updatedAt"`
}

func (QuizLeaderboard) TableName() string {
	return "QuizLeaderboard"
}

type ActivityWallet struct {
	ID          int       `gorm:"column:id;primaryKey" json:"id"`
	UserID      int       `gorm:"column:userId" json:"userId"`
	Type        string    `gorm:"column:type" json:"type"`
	Title       string    `gorm:"column:title" json:"title"`
	Description string    `gorm:"column:description" json:"description"`
	Amount      float64   `gorm:"column:amount" json:"amount"`
	Currency    string    `gorm:"column:currency" json:"currency"`
	Reference   *string   `gorm:"column:reference" json:"reference"`
	Status      string    `gorm:"column:status" json:"status"`
	CreatedAt   time.Time `gorm:"column:createdAt" json:"createdAt"`
}

func (ActivityWallet) TableName() string {
	return "ActivityWallet"
}

type CardFunding struct {
	ID        int       `gorm:"column:id;primaryKey" json:"id"`
	UserID    int       `gorm:"column:userId" json:"userId"`
	WalletID  *int      `gorm:"column:walletId" json:"walletId"`
	Amount    float64   `gorm:"column:amount" json:"amount"`
	Currency  string    `gorm:"column:currency" json:"currency"`
	Reference string    `gorm:"column:reference" json:"reference"`
	Status    string    `gorm:"column:status" json:"status"`
	CreatedAt time.Time `gorm:"column:createdAt" json:"createdAt"`
	UpdatedAt time.Time `gorm:"column:updatedAt" json:"updatedAt"`
}

func (CardFunding) TableName() string {
	return "CardFunding"
}

type UserWithdrawalBank struct {
	ID            int       `gorm:"column:id;primaryKey" json:"id"`
	AccountName   string    `gorm:"column:accountName" json:"accountName"`
	AccountNumber string    `gorm:"column:accountNumber" json:"accountNumber"`
	BankName      string    `gorm:"column:bankName" json:"bankName"`
	BankCode      string    `gorm:"column:bankCode" json:"bankCode"`
	UserID        int       `gorm:"column:userId" json:"userId"`
	CreatedAt     time.Time `gorm:"column:createdAt" json:"createdAt"`
}

func (UserWithdrawalBank) TableName() string {
	return "UserWithdrawalBank"
}

type UserWithdrawalWallet struct {
	ID            int       `gorm:"column:id;primaryKey" json:"id"`
	WalletAddress string    `gorm:"column:walletAddress" json:"walletAddress"`
	RecipientID   *string   `gorm:"column:recipientId" json:"recipientId"`
	Symbol        string    `gorm:"column:symbol" json:"symbol"`
	Network       string    `gorm:"column:network" json:"network"`
	UserID        int       `gorm:"column:userId" json:"userId"`
	CreatedAt     time.Time `gorm:"column:createdAt" json:"createdAt"`
}

func (UserWithdrawalWallet) TableName() string {
	return "UserWithdrawalWallet"
}

type UserCard struct {
	ID         int       `gorm:"column:id;primaryKey" json:"id"`
	UserID     int       `gorm:"column:userId" json:"userId"`
	CardToken  *string   `gorm:"column:cardToken" json:"cardToken"`
	CardNumber *string   `gorm:"column:cardNumber" json:"cardNumber"`
	MaskedPan  *string   `gorm:"column:maskedPan" json:"maskedPan"`
	CardType   *string   `gorm:"column:cardType" json:"cardType"`
	Expiry     *string   `gorm:"column:expiry" json:"expiry"`
	Issuer     *string   `gorm:"column:issuer" json:"issuer"`
	Country    *string   `gorm:"column:country" json:"country"`
	IsDefault  bool      `gorm:"column:isDefault" json:"isDefault"`
	CreatedAt  time.Time `gorm:"column:createdAt" json:"createdAt"`
	UpdatedAt  time.Time `gorm:"column:updatedAt" json:"updatedAt"`
}

func (UserCard) TableName() string {
	return "UserCard"
}

type Payout struct {
	ID          int        `gorm:"column:id;primaryKey" json:"id"`
	UserID      int        `gorm:"column:userId" json:"userId"`
	Amount      float64    `gorm:"column:amount" json:"amount"`
	Method      string     `gorm:"column:method" json:"method"`
	Reference   string     `gorm:"column:reference" json:"reference"`
	Currency    string     `gorm:"column:currency" json:"currency"`
	Status      string     `gorm:"column:status" json:"status"`
	Provider    *string    `gorm:"column:provider" json:"provider"`
	ProviderRef *string    `gorm:"column:providerRef" json:"providerRef"`
	ProcessedAt *time.Time `gorm:"column:processedAt" json:"processedAt"`
	CreatedAt   time.Time  `gorm:"column:createdAt" json:"createdAt"`
}

func (Payout) TableName() string {
	return "Payout"
}

