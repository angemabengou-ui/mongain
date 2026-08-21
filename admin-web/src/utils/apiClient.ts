import axios from 'axios';
import { API_URL } from '../config';

export const apiClient = axios.create({
    baseURL: API_URL,
});

apiClient.interceptors.request.use((config) => {
    // VUL-05 : Token lu depuis sessionStorage (non-persistant, scoped par tab)
    const token = sessionStorage.getItem('admin_token');
    if (token) {
        config.headers.Authorization = `Bearer ${token}`;
    }
    return config;
});

apiClient.interceptors.response.use(
    (response) => response,
    (error) => {
        if (error.response && (error.response.status === 401 || error.response.status === 403)) {
            // Unauthenticated or Unauthorized -> clear session
            sessionStorage.removeItem('admin_token'); // token : sessionStorage
            localStorage.removeItem('admin_role');
            localStorage.removeItem('admin_name');
            localStorage.removeItem('admin_phone');
            localStorage.removeItem('admin_must_change_pw');
            localStorage.removeItem('admin_active_tab');
            localStorage.removeItem('admin_expanded_group');
            window.location.reload();
        }
        return Promise.reject(error);
    }
);

export default apiClient;
