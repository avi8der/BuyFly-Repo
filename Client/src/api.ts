import axios from "axios";

const api = axios.create({
  baseURL: process.env.REACT_APP_API_URL || "https://buyfly-server.onrender.com",
});

export default api;
