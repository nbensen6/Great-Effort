# Team Great Effort — Team Hub

A team management website for the Team Great Effort League of Legends team featuring authentication, stats tracking, draft assistance, and team collaboration tools.

Forked from the IQ team hub, and deploys as the Fly app `tge-lol-team`. Data lives on the `tge_data` volume and is entirely this team's.

## Features

- **Authentication System**: User registration with JWT-based auth and role management (Admin/Player/Viewer)
- **Stats Page**: CSV file upload for match statistics with sortable/filterable data tables
- **Draft Helper**: All 168+ League champions with role filtering, search, and pick/ban simulation
- **Notes System**: Personal and champion-specific notes tied to user accounts
- **Team Roster**: Player profiles with roles and champion pools
- **Announcements**: Admin-managed team announcements
- **Dark/Light Theme**: Gaming-appropriate dark theme by default

## Tech Stack

- **Frontend**: React 18, React Router, Axios
- **Backend**: Node.js, Express
- **Database**: SQLite (better-sqlite3)
- **Auth**: JWT, bcrypt

## Getting Started

### Prerequisites

- Node.js 18+
- npm

### Installation

1. Clone the repository:
```bash
git clone https://github.com/nbensen6/GreatEffortWebsite.git
cd GreatEffortWebsite
```

2. Install dependencies:
```bash
npm run install-all
```

Or install manually:
```bash
npm install
cd client && npm install
cd ../server && npm install
```

### Running the Application

**Development mode** (runs both client and server):
```bash
npm run dev
```

Or run separately:
```bash
# Terminal 1 - Server
cd server && npm run dev

# Terminal 2 - Client
cd client && npm start
```

The client runs on `http://localhost:3000` and the server on `http://localhost:5000`.

## CSV Format for Stats Upload

```csv
date,player,champion,kills,deaths,assists,cs,vision_score,damage,gold,result
2024-01-15,Player1,Jinx,8,2,10,285,45,32000,14500,Win
```

## Project Structure

```
GreatEffort/
├── client/                 # React frontend
│   ├── public/
│   │   ├── logo.png       # Horizontal lockup (navbar), transparent
│   │   └── favicon.ico    # Dragon head on dark square
│   └── src/
│       ├── components/    # Reusable components
│       ├── pages/         # Page components
│       ├── context/       # Auth & Theme context
│       ├── services/      # API calls
│       └── assets/        # Styles
├── server/                 # Node.js backend
│   ├── routes/            # API routes
│   ├── middleware/        # Auth middleware
│   └── database/          # SQLite setup
└── package.json
```

## External APIs

- **Riot Data Dragon**: Free CDN for champion images and data (no API key needed)

## Notes

- First registered user becomes admin
- Champion images loaded from Riot's Data Dragon CDN
- SQLite database stored in `server/database/tge.db`
