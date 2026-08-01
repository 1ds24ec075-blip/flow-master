import { useEffect, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { lovable } from "@/integrations/lovable";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";

function safeNext(raw: string | null): string {
  if (!raw) return "/";
  try {
    const decoded = decodeURIComponent(raw);
    // Only accept same-origin relative paths
    if (decoded.startsWith("/") && !decoded.startsWith("//")) return decoded;
  } catch {}
  return "/";
}

const Auth = () => {
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const next = safeNext(params.get("next"));
  const [loading, setLoading] = useState(false);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [emailLoading, setEmailLoading] = useState(false);

  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => {
      if (session) {
        if (next.startsWith("/.lovable/")) {
          window.location.href = next;
        } else {
          navigate(next);
        }
      }
    });

    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      if (session) {
        if (next.startsWith("/.lovable/")) {
          window.location.href = next;
        } else {
          navigate(next);
        }
      }
    });

    return () => subscription.unsubscribe();
  }, [navigate, next]);

  const handleGoogleSignIn = async () => {
    setLoading(true);
    try {
      const redirectTarget = `${window.location.origin}/auth?next=${encodeURIComponent(next)}`;
      const { error } = await lovable.auth.signInWithOAuth("google", {
        redirect_uri: redirectTarget,
      });

      if (error) {
        toast.error("Failed to sign in with Google");
        console.error("Google sign-in error:", error);
      }
    } catch (err) {
      toast.error("An unexpected error occurred");
      console.error("Sign-in error:", err);
    } finally {
      setLoading(false);
    }
  };

  // Google OAuth redirects through oauth.lovable.app, which only accepts origins
  // registered for the deployed app — so it cannot complete from localhost.
  // Email sign-in talks to Supabase directly and works from any origin.
  const handleEmailAuth = async (mode: "signin" | "signup") => {
    if (!email.trim() || !password) {
      toast.error("Enter both an email and a password");
      return;
    }
    setEmailLoading(true);
    try {
      if (mode === "signin") {
        const { error } = await supabase.auth.signInWithPassword({
          email: email.trim(),
          password,
        });
        if (error) throw error;
        // The onAuthStateChange subscription above handles the redirect.
        return;
      }

      const { data, error } = await supabase.auth.signUp({
        email: email.trim(),
        password,
        options: { emailRedirectTo: `${window.location.origin}/auth` },
      });
      if (error) throw error;

      // Signup returns a user but no session when confirmation is required.
      if (data.user && !data.session) {
        toast.success("Check your email to confirm the account, then sign in.");
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Authentication failed");
    } finally {
      setEmailLoading(false);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-background p-4">
      <Card className="w-full max-w-md">
        <CardHeader className="text-center">
          <CardTitle className="text-2xl font-bold">Welcome</CardTitle>
          <CardDescription>Sign in to access your workflow automation</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <Button 
            variant="outline" 
            className="w-full h-11 gap-3"
            onClick={handleGoogleSignIn}
            disabled={loading}
          >
            <svg className="h-5 w-5" viewBox="0 0 24 24">
              <path
                d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"
                fill="#4285F4"
              />
              <path
                d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"
                fill="#34A853"
              />
              <path
                d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"
                fill="#FBBC05"
              />
              <path
                d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"
                fill="#EA4335"
              />
            </svg>
            {loading ? "Signing in..." : "Continue with Google"}
          </Button>

          <div className="relative">
            <div className="absolute inset-0 flex items-center">
              <span className="w-full border-t" />
            </div>
            <div className="relative flex justify-center text-xs uppercase">
              <span className="bg-card px-2 text-muted-foreground">or</span>
            </div>
          </div>

          <div className="space-y-3">
            <div className="space-y-2">
              <Label htmlFor="email">Email</Label>
              <Input
                id="email"
                type="email"
                autoComplete="email"
                placeholder="you@example.com"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="password">Password</Label>
              <Input
                id="password"
                type="password"
                autoComplete="current-password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") handleEmailAuth("signin");
                }}
              />
            </div>
            <div className="flex gap-2">
              <Button
                className="flex-1"
                onClick={() => handleEmailAuth("signin")}
                disabled={emailLoading}
              >
                {emailLoading ? "Working…" : "Sign in"}
              </Button>
              <Button
                variant="outline"
                className="flex-1"
                onClick={() => handleEmailAuth("signup")}
                disabled={emailLoading}
              >
                Create account
              </Button>
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
};

export default Auth;
