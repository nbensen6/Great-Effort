import React from 'react';
import { Link, NavLink, useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';

function Navbar() {
  const { user, logout } = useAuth();
  const navigate = useNavigate();

  const handleLogout = () => {
    logout();
    navigate('/');
  };

  return (
    <nav className="navbar">
      <Link to="/" className="nav-brand">
        <img src="/logo.png" alt="Team Great Effort Logo" className="nav-logo" />
      </Link>

      <div className="nav-links">
        <NavLink to="/" end>Home</NavLink>
        <NavLink to="/roster">Roster</NavLink>
        {user && (
          <>
            <NavLink to="/stats">Stats</NavLink>
            <NavLink to="/draft">Draft</NavLink>
            <NavLink to="/scouting">Scouting</NavLink>
            <NavLink to="/notes">Notes</NavLink>
          </>
        )}
      </div>

      <div className="nav-user">
        {user ? (
          <>
            <span>{user.username}</span>
            <button className="btn btn-secondary btn-small" onClick={handleLogout}>
              Logout
            </button>
          </>
        ) : (
          <>
            <Link to="/login" className="btn btn-secondary btn-small">Login</Link>
            <Link to="/register" className="btn btn-primary btn-small">Register</Link>
          </>
        )}
      </div>
    </nav>
  );
}

export default Navbar;
