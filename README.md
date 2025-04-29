
# AI Mentor Backend

This is the backend server of my AI Mentor, an progressive tutoring system which provides personalized learning experiences in various subjects.
Mentor AI backend is built using Node.js and Express with MongoDB being the database. It provides RESTful APIs to support the Mentor AI web and mobile applications, including user authentication, conversation management, performance tracking, and OpenAI integration for AI-powered tutoring.

## Features

Secure signup, signin, and password reset functionality. There is also independent conversation hsitory for different subject tutors
Track and monitor user progress on various subjects and topics. My Database is MongoDB and it store and retrieve learning content as well as user credentials and profile information. Bcrypt for password hashing, JWT authentication, secure HTTPS connection
and CORS setup for all defined allowed domains.

## Getting Started

1. Clone the repository
2. Install dependencies with `npm install`
3. Set environment variables
4. Run the server with `node server.js` or `sudo node server.js` if you want a https connection


## API Endpoints

### Authentication

- `POST /signup`: Create new user account
- `POST /signin`: Authenticate a user and obtain a JWT token
- `POST /reset-password`: Request a password reset

### Conversations

- `GET /api/conversations`: Get all conversations for a tutor
- `POST /api/conversations`: Create a new conversation
- `POST /api/messages`: Add a message to a conversation
- `DELETE /api/conversations/:id`: Remove a conversation

### Performance Tracking

- `GET /api/performance`: Get performance data with optional filters
- `POST /api/performance`: Save new performance data
- `GET /api/progress/subtopics`: Get detailed progress by subtopics

### Learning Content

- `POST /api/learning-content`: Create new learning content
- `GET /api/learning-content/:topicId`: Get specific learning content
- `GET /api/learning-content`: Get learning content with optional filters

### AI Integration

- `POST /api/openai`: Send a message to OpenAI with tutor-specific context

## Technical Architecture

### Database Models

MongoDB stores chat history, authentication details, and all tracked user learning performance data.

### Key Design Patterns

- **Dynamic Model Generation**: Conversation models for every topic are created dynamically
- **Performance Analytics**: Granular analytics of user progress in learning
- **Mastery Level Computation**: Algorithm to compute user's mastery level from performance

## Environment Configuration

The server requires the following environment variables:
Change the PORT to whatever you else you want to run on (as long as its not below 1000)

```
MONGODB_URI= mongodb://your-mongodb-connection-string
JWT_STRING= jwt-secret-key
EXTRA_BCRYPT_STRING= additional-bcrypt-salt
OPENAI_API_KEY= openai-api-key
PORT= 3000
HTTPS_PORT= 443
```

## Deployment

The server is HTTP and HTTPS protocol compatible. For HTTPS, SSL certificates exist at:
- `/etc/letsencrypt/live/api.teachmetutor.academy/privkey.pem`
- `/etc/letsencrypt/live/api.teachmetutor.academy/fullchain.pem`
- `/etc/letsencrypt/live/api.teachmetutor.academy/chain.pem`

If certificates don't exist, the server will be HTTP mode only. Meaning it wont work on Netlify(requires https connection).
