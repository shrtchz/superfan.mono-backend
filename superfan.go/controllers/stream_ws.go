package controllers

import (
	"log"
	"net/http"
	"sync"

	"github.com/gin-gonic/gin"
	"github.com/gorilla/websocket"
)

var upgrader = websocket.Upgrader{
	CheckOrigin: func(r *http.Request) bool {
		return true // Allow all origins for development
	},
}

// Hub manages WebSocket clients and rooms for streams
type Hub struct {
	rooms map[string]map[*websocket.Conn]bool
	mu    sync.RWMutex
}

// StreamHub is the global instance managing all stream chat connections
var StreamHub = &Hub{
	rooms: make(map[string]map[*websocket.Conn]bool),
}

// AddClient adds a WebSocket connection to a specific stream room
func (h *Hub) AddClient(roomID string, conn *websocket.Conn) {
	h.mu.Lock()
	defer h.mu.Unlock()
	if h.rooms[roomID] == nil {
		h.rooms[roomID] = make(map[*websocket.Conn]bool)
	}
	h.rooms[roomID][conn] = true
	log.Printf("Client connected to room: %s", roomID)
}

// RemoveClient removes a WebSocket connection from a stream room
func (h *Hub) RemoveClient(roomID string, conn *websocket.Conn) {
	h.mu.Lock()
	defer h.mu.Unlock()
	if h.rooms[roomID] != nil {
		delete(h.rooms[roomID], conn)
		if len(h.rooms[roomID]) == 0 {
			delete(h.rooms, roomID)
		}
		log.Printf("Client disconnected from room: %s", roomID)
	}
}

// StreamWebSocket handles incoming WebSocket connections for streaming chat
func StreamWebSocket(c *gin.Context) {

	conn, err := upgrader.Upgrade(c.Writer, c.Request, nil)
	if err != nil {
		log.Println("WebSocket upgrade failed:", err)
		return
	}
	defer conn.Close()

	// Parse incoming JSON messages
	type SocketMessage struct {
		Event string      `json:"event"`
		Data  interface{} `json:"data"`
	}

	var currentRoom string

	for {
		var msg SocketMessage
		if err := conn.ReadJSON(&msg); err != nil {
			log.Println("WebSocket read error or client disconnected:", err)
			if currentRoom != "" {
				StreamHub.RemoveClient(currentRoom, conn)
			}
			break
		}

		switch msg.Event {
		case "joinStream":
			if room, ok := msg.Data.(string); ok {
				if currentRoom != "" {
					StreamHub.RemoveClient(currentRoom, conn)
				}
				currentRoom = room
				StreamHub.AddClient(currentRoom, conn)
			}
		case "leaveStream":
			if room, ok := msg.Data.(string); ok && room == currentRoom {
				StreamHub.RemoveClient(currentRoom, conn)
				currentRoom = ""
			}
		case "register":
			// User ID registration (handled in connection state if needed)
		default:
			// For streamMessage, replyMessage, likeComment, etc.
			// Broadcast the event to the entire room
			if currentRoom != "" {
				BroadcastToRoom(currentRoom, msg)
			}
		}
	}
}

// BroadcastToRoom sends a JSON message to all connected clients in a specific stream room
func BroadcastToRoom(roomID string, message interface{}) {
	StreamHub.mu.RLock()
	defer StreamHub.mu.RUnlock()

	for conn := range StreamHub.rooms[roomID] {
		err := conn.WriteJSON(message)
		if err != nil {
			log.Printf("Error writing to client in room %s: %v", roomID, err)
		}
	}
}
