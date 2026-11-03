package utils

import (
	"log"

	"github.com/posthog/posthog-go"
)

var PostHogClient posthog.Client

// InitPostHog initializes PostHog client with an API key and host.
func InitPostHog(apiKey string, host string) {
	if apiKey == "" {
		log.Println("POSTHOG_API_KEY is not set; skipping PostHog initialization")
		return
	}

	if host == "" {
		host = "https://us.i.posthog.com"
	}

	client, err := posthog.NewWithConfig(apiKey, posthog.Config{
		Endpoint: host,
	})
	if err != nil {
		log.Printf("Failed to initialize PostHog: %v", err)
		return
	}

	PostHogClient = client
	log.Println("PostHog initialized successfully")
}

// ClosePostHog closes the PostHog client and flushes buffered events.
func ClosePostHog() {
	if PostHogClient != nil {
		_ = PostHogClient.Close()
	}
}

// TrackEvent helper to safely send events to PostHog without crashing if client is nil.
func TrackEvent(distinctID, eventName string, properties map[string]interface{}) {
	if PostHogClient == nil {
		return
	}

	props := posthog.NewProperties()
	for k, v := range properties {
		props.Set(k, v)
	}

	err := PostHogClient.Enqueue(posthog.Capture{
		DistinctId: distinctID,
		Event:      eventName,
		Properties: props,
	})
	if err != nil {
		log.Printf("PostHog Enqueue error: %v", err)
	}
}
