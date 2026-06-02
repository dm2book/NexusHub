import { Navigate, useLocation } from 'react-router-dom';
import { useAuth } from '../context/AuthContext.jsx';
import { PageLoader } from './ui.jsx';

/** Gate a route on authentication and (optionally) staff/permission. */
export default function ProtectedRoute({ children, staff = false, permission }) {
  const { user, loading, isStaff, hasPermission } = useAuth();
  const location = useLocation();

  if (loading) return <PageLoader />;
  if (!user) return <Navigate to="/login" state={{ from: location.pathname }} replace />;
  if (staff && !isStaff) return <Navigate to="/account" replace />;
  if (permission && !hasPermission(permission)) {
    return (
      <div className="max-w-md mx-auto py-24 text-center">
        <h2 className="text-xl text-white mb-2">Access denied</h2>
        <p className="text-slate-400">You don’t have permission to view this page.</p>
      </div>
    );
  }
  return children;
}
