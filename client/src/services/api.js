import axios from 'axios';

const api = axios.create({
  baseURL: '/api',
  headers: {
    'Content-Type': 'application/json'
  }
});

// Add token to requests
api.interceptors.request.use(
  (config) => {
    const token = localStorage.getItem('token');
    if (token) {
      config.headers.Authorization = `Bearer ${token}`;
    }
    return config;
  },
  (error) => {
    return Promise.reject(error);
  }
);

// Handle response errors
api.interceptors.response.use(
  (response) => response,
  (error) => {
    if (error.response?.status === 401) {
      // Only bounce to login when a session actually expired. Anonymous visitors
      // hitting an auth-only endpoint from a public page (/roster loads
      // /compositions) must stay where they are.
      const hadSession = !!localStorage.getItem('token');
      localStorage.removeItem('token');
      if (hadSession) {
        window.location.href = '/login';
      }
    }
    return Promise.reject(error);
  }
);

export default api;
