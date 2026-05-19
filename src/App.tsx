import { Route, Switch, useLocation } from "wouter";
import { useEffect } from "react";
import { AuthProvider, useAuth } from "./lib/auth-context";
import { ToastProvider } from "./components/Toast";
import { AppLayout } from "./components/AppLayout";
import Login from "./pages/Login";
import SetPassword from "./pages/SetPassword";
import ForgotPassword from "./pages/ForgotPassword";
import Dashboard from "./pages/Dashboard";
import MyTasks from "./pages/MyTasks";
import MyTimesheet from "./pages/MyTimesheet";
import AdminUsers from "./pages/AdminUsers";
import AdminTasks from "./pages/AdminTasks";
import AdminTimesheets from "./pages/AdminTimesheets";
import AdminManage from "./pages/AdminManage";
import AdminQueries from "./pages/AdminQueries";
import MyQueries from "./pages/MyQueries";

function Protected() {
  const { user, loading } = useAuth();
  const [, navigate] = useLocation();

  useEffect(() => {
    const path = window.location.pathname;
    const publicPaths = ["/login", "/forgot-password", "/auth/set-password"];
    if (!loading && !user && !publicPaths.includes(path)) {
      navigate("/login");
    }
  }, [user, loading]);

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="text-sm text-white/50">Loading…</div>
      </div>
    );
  }
  if (!user) return null;

  const isAdmin = user.role === "ADMIN";

  return (
    <AppLayout>
      <Switch>
        <Route path="/" component={Dashboard} />
        <Route path="/my-tasks" component={MyTasks} />
        <Route path="/my-timesheet" component={MyTimesheet} />
        <Route path="/my-queries" component={MyQueries} />
        {isAdmin && <Route path="/users" component={AdminUsers} />}
        {isAdmin && <Route path="/tasks" component={AdminTasks} />}
        {isAdmin && <Route path="/timesheets" component={AdminTimesheets} />}
        {isAdmin && <Route path="/manage" component={AdminManage} />}
        {isAdmin && <Route path="/queries" component={AdminQueries} />}
        <Route>
          <div className="ko-card p-6 text-sm text-white/55">Page not found.</div>
        </Route>
      </Switch>
    </AppLayout>
  );
}

export default function App() {
  return (
    <AuthProvider>
      <ToastProvider>
        <Switch>
          <Route path="/login" component={Login} />
          <Route path="/forgot-password" component={ForgotPassword} />
          <Route path="/auth/set-password" component={SetPassword} />
          <Route component={Protected} />
        </Switch>
      </ToastProvider>
    </AuthProvider>
  );
}
