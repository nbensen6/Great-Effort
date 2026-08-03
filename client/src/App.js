import React from 'react';
import { Routes, Route, Navigate } from 'react-router-dom';
import { useAuth } from './context/AuthContext';
import Navbar from './components/Navbar';
import Home from './pages/Home';
import Login from './pages/Login';
import Register from './pages/Register';
import Stats from './pages/Practice';
import DraftHelper from './pages/DraftHelper';
import Notes from './pages/Notes';
import Scouting from './pages/Scouting';
import Roster from './pages/Roster';

function ProtectedRoute({ children }) {
  const { user, loading } = useAuth();

  if (loading) {
    return <div className="loading">Loading...</div>;
  }

  return user ? children : <Navigate to="/login" />;
}

function App() {
  return (
    <div className="app">
      <Navbar />
      <main className="main-content">
        <Routes>
          <Route path="/" element={<Home />} />
          <Route path="/login" element={<Login />} />
          <Route path="/register" element={<Register />} />
          <Route path="/stats" element={
            <ProtectedRoute>
              <Stats />
            </ProtectedRoute>
          } />
          <Route path="/draft" element={
            <ProtectedRoute>
              <DraftHelper />
            </ProtectedRoute>
          } />
          <Route path="/notes" element={
            <ProtectedRoute>
              <Notes />
            </ProtectedRoute>
          } />
          <Route path="/scouting" element={
            <ProtectedRoute>
              <Scouting />
            </ProtectedRoute>
          } />
          <Route path="/roster" element={<Roster />} />
        </Routes>
      </main>
    </div>
  );
}

export default App;
