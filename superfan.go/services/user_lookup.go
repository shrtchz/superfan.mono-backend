package services

import (
	"errors"
	"strings"

	"quiz.superfan.com/apis/models"
	"quiz.superfan.com/apis/utils"

	"gorm.io/gorm"
)

// ResolveLocalUserID maps a Clerk subject to the local Postgres user id.
// Lookup order: clerkUserId → email (JWT claim) → not found.
func ResolveLocalUserID(clerkSub string, email string) (int, error) {
	if utils.DB == nil {
		return 0, errors.New("database connection not initialized")
	}

	clerkSub = strings.TrimSpace(clerkSub)
	if clerkSub == "" {
		return 0, errors.New("missing clerk subject")
	}

	var user models.User
	err := utils.DB.Where(`"clerkUserId" = ?`, clerkSub).First(&user).Error
	if err == nil {
		return user.ID, nil
	}
	if !errors.Is(err, gorm.ErrRecordNotFound) {
		return 0, err
	}

	email = strings.TrimSpace(email)
	if email != "" {
		err = utils.DB.Where(`"email" = ?`, email).First(&user).Error
		if err == nil {
			return user.ID, nil
		}
		if !errors.Is(err, gorm.ErrRecordNotFound) {
			return 0, err
		}
	}

	return 0, gorm.ErrRecordNotFound
}
