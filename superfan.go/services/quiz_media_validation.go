package services

import (
	"fmt"
	"os/exec"
	"strconv"
	"strings"
)

const maxVideoDurationSeconds = 120

func validateVideoDurationSeconds(duration float64) error {
	if duration > maxVideoDurationSeconds {
		return fmt.Errorf("video exceeds the %d second limit; received %.0f seconds", maxVideoDurationSeconds, duration)
	}
	return nil
}

func validateQuizMediaUrls(media []string) error {
	for _, raw := range media {
		trimmed := strings.TrimSpace(raw)
		if trimmed == "" {
			continue
		}
		lower := strings.ToLower(trimmed)
		if !strings.Contains(lower, ".mp4") && !strings.Contains(lower, ".mov") && !strings.Contains(lower, ".webm") && !strings.Contains(lower, ".m4v") {
			continue
		}

		cmd := exec.Command("ffprobe", "-v", "error", "-show_entries", "format=duration", "-of", "default=nw=1:nk=1", trimmed)
		out, err := cmd.Output()
		if err != nil {
			return fmt.Errorf("video duration validation failed for %s: %w", trimmed, err)
		}
		duration, err := strconv.ParseFloat(strings.TrimSpace(string(out)), 64)
		if err != nil {
			return fmt.Errorf("video duration validation failed for %s: %w", trimmed, err)
		}
		if err := validateVideoDurationSeconds(duration); err != nil {
			return err
		}
	}
	return nil
}
