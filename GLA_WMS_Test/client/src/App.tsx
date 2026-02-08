import { Switch, Route, Redirect } from "wouter";
import { queryClient } from "./lib/queryClient";
import { QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { AuthProvider, useAuth } from "@/lib/auth";

import LoginPage from "@/pages/login";
import HomePage from "@/pages/home";
import SupervisorDashboard from "@/pages/supervisor/index";
import OrdersPage from "@/pages/supervisor/orders";
import ExceptionsPage from "@/pages/supervisor/exceptions";
import UsersPage from "@/pages/supervisor/users";
import RoutesPage from "@/pages/supervisor/routes";
import RouteOrdersPage from "@/pages/supervisor/route-orders";
import ReportsPage from "@/pages/supervisor/reports";
import PickingListReportPage from "@/pages/supervisor/reports/picking-list";
import SeparacaoPage from "@/pages/separacao/index";
import ConferenciaPage from "@/pages/conferencia/index";
import BalcaoPage from "@/pages/balcao/index";
import PickingPage from "@/pages/handheld/picking";
import NotFound from "@/pages/not-found";
import { Loader2 } from "lucide-react";

function LoadingScreen() {
  return (
    <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-[hsl(255,30%,20%)] via-[hsl(255,35%,30%)] to-[hsl(280,40%,35%)]">
      <div className="flex flex-col items-center gap-4">
        <Loader2 className="h-10 w-10 text-white animate-spin" />
        <p className="text-white/80">Carregando...</p>
      </div>
    </div>
  );
}

function ProtectedRoute({ children, allowedRoles }: { children: React.ReactNode; allowedRoles?: string[] }) {
  const { user, status } = useAuth();

  if (status === "loading") {
    return <LoadingScreen />;
  }

  if (status === "unauthenticated") {
    return <Redirect to="/login" />;
  }

  if (allowedRoles && user && !allowedRoles.includes(user.role)) {
    return <Redirect to="/" />;
  }

  return <>{children}</>;
}

function PublicRoute({ children }: { children: React.ReactNode }) {
  const { status } = useAuth();

  if (status === "loading") {
    return <LoadingScreen />;
  }

  if (status === "authenticated") {
    return <Redirect to="/" />;
  }

  return <>{children}</>;
}

function Router() {
  return (
    <Switch>
      <Route path="/login">
        <PublicRoute>
          <LoginPage />
        </PublicRoute>
      </Route>

      <Route path="/">
        <ProtectedRoute>
          <HomePage />
        </ProtectedRoute>
      </Route>

      <Route path="/supervisor">
        <ProtectedRoute allowedRoles={["supervisor"]}>
          <SupervisorDashboard />
        </ProtectedRoute>
      </Route>

      <Route path="/supervisor/orders">
        <ProtectedRoute allowedRoles={["supervisor"]}>
          <OrdersPage />
        </ProtectedRoute>
      </Route>

      <Route path="/supervisor/exceptions">
        <ProtectedRoute allowedRoles={["supervisor"]}>
          <ExceptionsPage />
        </ProtectedRoute>
      </Route>

      <Route path="/supervisor/users">
        <ProtectedRoute allowedRoles={["supervisor"]}>
          <UsersPage />
        </ProtectedRoute>
      </Route>

      <Route path="/supervisor/routes">
        <ProtectedRoute allowedRoles={["supervisor"]}>
          <RoutesPage />
        </ProtectedRoute>
      </Route>

      <Route path="/supervisor/route-orders">
        <ProtectedRoute allowedRoles={["supervisor"]}>
          <RouteOrdersPage />
        </ProtectedRoute>
      </Route>

      <Route path="/supervisor/reports">
        <ProtectedRoute allowedRoles={["supervisor"]}>
          <ReportsPage />
        </ProtectedRoute>
      </Route>

      <Route path="/supervisor/reports/picking-list">
        <ProtectedRoute allowedRoles={["supervisor"]}>
          <PickingListReportPage />
        </ProtectedRoute>
      </Route>

      <Route path="/separacao">
        <ProtectedRoute allowedRoles={["separacao"]}>
          <SeparacaoPage />
        </ProtectedRoute>
      </Route>

      <Route path="/conferencia">
        <ProtectedRoute allowedRoles={["supervisor", "conferencia"]}>
          <ConferenciaPage />
        </ProtectedRoute>
      </Route>

      <Route path="/balcao">
        <ProtectedRoute allowedRoles={["supervisor", "balcao"]}>
          <BalcaoPage />
        </ProtectedRoute>
      </Route>

      <Route path="/handheld/picking">
        <ProtectedRoute allowedRoles={["separacao"]}>
          <PickingPage />
        </ProtectedRoute>
      </Route>

      <Route component={NotFound} />
    </Switch>
  );
}

function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <TooltipProvider>
        <AuthProvider>
          <Toaster />
          <Router />
        </AuthProvider>
      </TooltipProvider>
    </QueryClientProvider>
  );
}

export default App;
