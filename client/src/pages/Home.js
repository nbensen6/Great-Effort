import React from 'react';
import { Link } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import PageBackground from '../components/PageBackground';

function Home() {
  const { user } = useAuth();

  return (
    <PageBackground>
      <div className="home">
        {!user && (
          <div className="home-hero">
            <div style={{display: 'flex', gap: '1rem', justifyContent: 'center', marginTop: '2rem'}}>
              <Link to="/register" className="btn btn-primary">Join the Team</Link>
              <Link to="/login" className="btn btn-secondary">Sign In</Link>
            </div>
          </div>
        )}

        <div className="home-features">
          <Link to="/stats" className="card feature-card feature-link">
            <h3>Stats Tracking</h3>
            <p>Auto-sync practice matches from Riot API and track champion performance across the team.</p>
          </Link>

          <Link to="/draft" className="card feature-card feature-link">
            <h3>Draft Helper</h3>
            <p>Plan your team compositions with our interactive draft tool.</p>
          </Link>

          <Link to="/scouting" className="card feature-card feature-link">
            <h3>Team Scouting</h3>
            <p>Scout enemy teams with draft screenshots and notes.</p>
          </Link>

          <Link to="/notes" className="card feature-card feature-link">
            <h3>Personal Notes</h3>
            <p>Keep notes on champions, strategies, and matchups.</p>
          </Link>
        </div>
      </div>
    </PageBackground>
  );
}

export default Home;
