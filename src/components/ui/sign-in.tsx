import React, { useState } from 'react';
import { AlertCircle, CheckCircle2, Eye, EyeOff } from 'lucide-react';

// --- TYPE DEFINITIONS ---

export interface SignInPageProps {
  title?: React.ReactNode;
  description?: React.ReactNode;
  heroImageSrc?: string;
  rightOverlay?: React.ReactNode;
  onSignIn?: (event: React.FormEvent<HTMLFormElement>) => void;
  onResetPassword?: () => void;
  onCreateAccount?: () => void;
  brandLockup?: React.ReactNode;
  modeTabs?: React.ReactNode;
  error?: string | null;
  notice?: string | null;
  loading?: boolean;
  defaultIdentifier?: string;
  defaultRememberMe?: boolean;
  capsLockOn?: boolean;
  onPasswordKeyEvent?: (event: React.KeyboardEvent<HTMLInputElement>) => void;
  customContent?: React.ReactNode;
}

// --- SUB-COMPONENTS ---

export const GlassInputWrapper = ({ children }: { children: React.ReactNode }) => (
  <div className="rounded-2xl border border-border bg-foreground/5 backdrop-blur-sm transition-colors focus-within:border-violet-400/70 focus-within:bg-violet-500/10">
    {children}
  </div>
);

// --- MAIN COMPONENT ---

export const SignInPage: React.FC<SignInPageProps> = ({
  title = <span className="font-light text-foreground tracking-tighter">Welcome</span>,
  description = 'Access your account and continue your journey with us',
  heroImageSrc,
  rightOverlay,
  onSignIn,
  onResetPassword,
  onCreateAccount,
  brandLockup,
  modeTabs,
  error,
  notice,
  loading = false,
  defaultIdentifier = '',
  defaultRememberMe = true,
  capsLockOn = false,
  onPasswordKeyEvent,
  customContent,
}) => {
  const [showPassword, setShowPassword] = useState(false);
  const [heroImgError, setHeroImgError] = useState(false);

  return (
    <div className="min-h-[100dvh] w-full flex flex-col md:flex-row font-geist bg-background text-foreground">
      {/* Left column: sign-in form or active auth flow */}
      <section className="flex-1 flex items-center justify-center p-6 sm:p-8 lg:p-12">
        <div className="w-full max-w-md">
          <div className="flex flex-col gap-5">
            {brandLockup && <div className="animate-element animate-delay-100">{brandLockup}</div>}

            {modeTabs && <div className="animate-element animate-delay-100">{modeTabs}</div>}

            <div className="space-y-2">
              <h1 className="animate-element animate-delay-100 text-3xl sm:text-4xl font-semibold leading-tight [text-wrap:balance]">
                {title}
              </h1>
              <p className="animate-element animate-delay-200 text-sm sm:text-base text-muted-foreground leading-relaxed">
                {description}
              </p>
            </div>

            {error && (
              <div
                role="alert"
                className="flex items-start gap-2.5 rounded-2xl border border-rose-500/40 bg-rose-500/10 px-4 py-3 text-xs text-rose-200"
              >
                <AlertCircle className="h-4 w-4 shrink-0 text-rose-400 mt-0.5" />
                <span>{error}</span>
              </div>
            )}

            {notice && (
              <div className="flex items-start gap-2.5 rounded-2xl border border-emerald-500/40 bg-emerald-500/10 px-4 py-3 text-xs text-emerald-200 break-all">
                <CheckCircle2 className="h-4 w-4 shrink-0 text-emerald-400 mt-0.5" />
                <span>{notice}</span>
              </div>
            )}

            {customContent ? (
              customContent
            ) : (
              <>
                <form className="space-y-5" onSubmit={onSignIn}>
                  <div className="animate-element animate-delay-300 space-y-1.5">
                    <label htmlFor="signin-identifier" className="block text-sm font-medium text-muted-foreground">
                      Email or Username
                    </label>
                    <GlassInputWrapper>
                      <input
                        id="signin-identifier"
                        name="identifier"
                        type="text"
                        required
                        autoComplete="username"
                        defaultValue={defaultIdentifier}
                        placeholder="Enter your email or @username"
                        className="w-full bg-transparent text-sm p-4 rounded-2xl text-foreground placeholder-muted-foreground/60 focus:outline-none"
                      />
                    </GlassInputWrapper>
                  </div>

                  <div className="animate-element animate-delay-400 space-y-1.5">
                    <label htmlFor="signin-password" className="block text-sm font-medium text-muted-foreground">
                      Password
                    </label>
                    <GlassInputWrapper>
                      <div className="relative">
                        <input
                          id="signin-password"
                          name="password"
                          type={showPassword ? 'text' : 'password'}
                          required
                          autoComplete="current-password"
                          onKeyUp={onPasswordKeyEvent}
                          onKeyDown={onPasswordKeyEvent}
                          placeholder="Enter your password"
                          className="w-full bg-transparent text-sm p-4 pr-12 rounded-2xl text-foreground placeholder-muted-foreground/60 focus:outline-none"
                        />
                        <button
                          type="button"
                          aria-label={showPassword ? 'Hide password' : 'Show password'}
                          onClick={() => setShowPassword(!showPassword)}
                          className="absolute inset-y-0 right-3 flex items-center text-muted-foreground hover:text-foreground transition-colors"
                        >
                          {showPassword ? <EyeOff className="w-5 h-5" /> : <Eye className="w-5 h-5" />}
                        </button>
                      </div>
                    </GlassInputWrapper>
                    {capsLockOn && <p className="text-xs text-amber-300">Caps Lock is currently active.</p>}
                  </div>

                  <div className="animate-element animate-delay-500 flex items-center justify-between text-sm">
                    <label className="flex items-center gap-3 cursor-pointer select-none">
                      <input
                        type="checkbox"
                        name="rememberMe"
                        defaultChecked={defaultRememberMe}
                        className="custom-checkbox"
                      />
                      <span className="text-foreground/90">Keep me signed in</span>
                    </label>
                    <a
                      href="#reset-password"
                      onClick={(e) => {
                        e.preventDefault();
                        onResetPassword?.();
                      }}
                      className="hover:underline text-violet-400 transition-colors"
                    >
                      Reset password
                    </a>
                  </div>

                  <button
                    type="submit"
                    disabled={loading}
                    className="animate-element animate-delay-600 w-full rounded-2xl bg-primary py-4 font-medium text-primary-foreground hover:bg-primary/90 transition-colors disabled:opacity-50"
                  >
                    {loading ? 'Signing in...' : 'Sign In'}
                  </button>
                </form>

                <p className="animate-element animate-delay-700 text-center text-sm text-muted-foreground">
                  New to Snout?{' '}
                  <a
                    href="#create-account"
                    onClick={(e) => {
                      e.preventDefault();
                      onCreateAccount?.();
                    }}
                    className="text-violet-400 hover:underline transition-colors"
                  >
                    Create Account
                  </a>
                </p>
              </>
            )}
          </div>
        </div>
      </section>

      {/* Right column: studio hero image + live workspace telemetry */}
      {heroImageSrc && (
        <section className="hidden md:block flex-1 relative p-4 min-h-[100dvh]">
          <div className="animate-slide-right animate-delay-300 absolute inset-4 rounded-3xl overflow-hidden bg-gradient-to-br from-[#171A21] via-[#101318] to-[#1C1E33] border border-white/10">
            {!heroImgError && (
              <img
                src={heroImageSrc}
                referrerPolicy="no-referrer"
                onError={() => setHeroImgError(true)}
                alt="Snout acoustic studio and real-time collaboration hub"
                className="h-full w-full object-cover"
              />
            )}
            <div className="pointer-events-none absolute inset-0 bg-gradient-to-t from-black/85 via-black/35 to-black/15" />
          </div>
          {rightOverlay && (
            <div className="absolute bottom-8 left-8 right-8 z-10 flex justify-center">
              {rightOverlay}
            </div>
          )}
        </section>
      )}
    </div>
  );
};
