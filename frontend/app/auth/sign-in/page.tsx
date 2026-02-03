'use client'

import { useState, useEffect, Suspense } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import Link from 'next/link'
import Image from 'next/image'
import { Eye, EyeOff } from 'lucide-react'

const taglines = [
  'Analyze CRISPR screens with precision',
  'Discover genetic dependencies faster',
  'Unlock insights from your data',
  'Transform screens into discoveries',
  'Powered by advanced algorithms',
]

function SignInForm() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const redirect = searchParams.get('redirect') || '/dashboard'
  const errorParam = searchParams.get('error')

  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)
  const [taglineIndex, setTaglineIndex] = useState(0)
  const [taglineFading, setTaglineFading] = useState(false)
  const [showPassword, setShowPassword] = useState(false)

  // Rotate taglines with fade animation
  useEffect(() => {
    const interval = setInterval(() => {
      setTaglineFading(true)
      setTimeout(() => {
        setTaglineIndex((prev) => (prev + 1) % taglines.length)
        setTaglineFading(false)
      }, 500)
    }, 4000)

    return () => clearInterval(interval)
  }, [])

  // Handle error from URL params
  useEffect(() => {
    if (errorParam === 'auth_callback_error') {
      setError('Authentication failed. Please try again.')
    }
  }, [errorParam])

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError('')
    setLoading(true)

    try {
      // Use server-side auth endpoint to bypass CORS issues
      const response = await fetch('/api/auth/signin', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ email, password }),
      })

      const contentType = response.headers.get('content-type')
      if (!contentType || !contentType.includes('application/json')) {
        setError('We couldn’t reach the server. Please check your connection and try again.')
        return
      }

      let data: { error?: string }
      try {
        const text = await response.text()
        if (!text || !text.trim()) {
          setError('Something went wrong. Please try again.')
          return
        }
        data = JSON.parse(text)
      } catch {
        setError('Something went wrong. Please try again.')
        return
      }

      if (!response.ok) {
        setError(data?.error || 'Invalid email or password. Please try again.')
        return
      }

      // Success - redirect to dashboard
      router.push(redirect)
      router.refresh()
    } catch (err) {
      console.error('Sign-in error:', err)
      if (err instanceof TypeError && err.message.includes('fetch')) {
        setError('We couldn’t reach the server. Please check your connection and try again.')
      } else {
        setError('Something went wrong. Please try again.')
      }
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="min-h-screen bg-white flex items-center justify-center px-4">
      <div className="w-full max-w-md">
        {/* Card Container */}
        <div className="bg-white rounded-2xl shadow-elevated p-8 md:p-10 border border-border-light">
          {/* Logo */}
          <div className="flex justify-center mb-8">
            <Link href="/" className="hover:opacity-90 transition-opacity">
              <Image
                src="/logo.jpeg"
                alt="SplicR"
                width={120}
                height={40}
                className="h-10 w-auto object-contain"
                priority
              />
            </Link>
          </div>

          {/* Header */}
          <div className="text-center mb-8">
            <h1 className="text-3xl font-serif text-text-primary mb-3">Welcome back</h1>
            <p
              className={`text-text-secondary font-serif text-sm h-5 transition-opacity duration-500 ${
                taglineFading ? 'opacity-0' : 'opacity-100'
              }`}
            >
              {taglines[taglineIndex]}
            </p>
          </div>

          {/* Error Message */}
          {error && (
            <div className="mb-6 p-3.5 bg-red-50 border border-red-200 rounded-lg animate-fadeIn">
              <p className="text-red-700 text-sm font-serif">{error}</p>
            </div>
          )}

          {/* Form */}
          <form onSubmit={handleSubmit} className="space-y-5">
            <div>
              <label className="block text-sm font-serif text-text-secondary mb-2">
                Email
              </label>
              <input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
                autoComplete="email"
                className="w-full px-4 py-3 bg-white border border-border rounded-xl font-serif text-text-primary placeholder:text-text-tertiary focus:outline-none focus:ring-2 focus:ring-accent/30 focus:border-accent transition-all"
                placeholder="you@institution.edu"
              />
            </div>

            <div>
              <div className="flex items-center justify-between mb-2">
                <label className="text-sm font-serif text-text-secondary">
                  Password
                </label>
                <Link
                  href="/auth/forgot-password"
                  className="text-xs font-serif text-text-tertiary hover:text-accent transition-colors"
                >
                  Forgot password?
                </Link>
              </div>
              <div className="relative">
                <input
                  type={showPassword ? 'text' : 'password'}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  required
                  autoComplete="current-password"
                  className="w-full px-4 py-3 pr-11 bg-white border border-border rounded-xl font-serif text-text-primary placeholder:text-text-tertiary focus:outline-none focus:ring-2 focus:ring-accent/30 focus:border-accent transition-all"
                  placeholder="Enter your password"
                />
                <button
                  type="button"
                  onClick={() => setShowPassword((p) => !p)}
                  className="absolute right-2.5 top-1/2 -translate-y-1/2 p-1.5 rounded-lg text-text-tertiary hover:text-text-primary hover:bg-black/5 transition-colors focus:outline-none focus:ring-2 focus:ring-accent/30 focus:ring-offset-0"
                  aria-label={showPassword ? 'Hide password' : 'Show password'}
                  tabIndex={-1}
                >
                  {showPassword ? (
                    <EyeOff className="w-4 h-4" strokeWidth={1.5} />
                  ) : (
                    <Eye className="w-4 h-4" strokeWidth={1.5} />
                  )}
                </button>
              </div>
            </div>

            <button
              type="submit"
              disabled={loading}
              className="w-full py-3.5 bg-accent text-white font-serif font-medium rounded-xl hover:bg-accent/90 active:scale-[0.99] transition-all disabled:opacity-50 disabled:cursor-not-allowed shadow-sm"
            >
              {loading ? (
                <span className="flex items-center justify-center gap-2">
                  <svg
                    className="animate-spin h-4 w-4"
                    xmlns="http://www.w3.org/2000/svg"
                    fill="none"
                    viewBox="0 0 24 24"
                  >
                    <circle
                      className="opacity-25"
                      cx="12"
                      cy="12"
                      r="10"
                      stroke="currentColor"
                      strokeWidth="4"
                    />
                    <path
                      className="opacity-75"
                      fill="currentColor"
                      d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"
                    />
                  </svg>
                  Signing in...
                </span>
              ) : (
                'Sign in'
              )}
            </button>
          </form>

          {/* Divider */}
          <div className="relative my-8">
            <div className="absolute inset-0 flex items-center">
              <div className="w-full border-t border-border-light" />
            </div>
            <div className="relative flex justify-center text-xs">
              <span className="px-4 bg-white text-text-tertiary font-serif">
                New to SplicR?
              </span>
            </div>
          </div>

          {/* Sign Up Link */}
          <Link
            href="/auth/sign-up"
            className="block w-full py-3.5 text-center border border-border rounded-xl font-serif text-text-primary hover:bg-background/50 active:scale-[0.99] transition-all"
          >
            Create an account
          </Link>
        </div>

        {/* Footer */}
        <div className="mt-8 text-center">
          <p className="text-xs text-text-tertiary font-serif">
            By signing in, you agree to our{' '}
            <a
              href="https://splicr.org/terms-and-conditions"
              target="_blank"
              rel="noopener noreferrer"
              className="text-accent underline hover:text-accent/80 transition-colors"
            >
              Terms & Conditions
            </a>
          </p>
        </div>
      </div>

      <style jsx>{`
        @keyframes fadeIn {
          from {
            opacity: 0;
            transform: translateY(-4px);
          }
          to {
            opacity: 1;
            transform: translateY(0);
          }
        }
        .animate-fadeIn {
          animation: fadeIn 0.3s ease-out;
        }
      `}</style>
    </div>
  )
}

// Loading fallback for Suspense
function SignInLoading() {
  return (
    <div className="min-h-screen bg-white flex items-center justify-center">
      <div className="animate-pulse">
        <div className="w-32 h-10 bg-border-light rounded mb-8 mx-auto" />
        <div className="w-80 h-96 bg-border-light rounded-2xl" />
      </div>
    </div>
  )
}

export default function SignInPage() {
  return (
    <Suspense fallback={<SignInLoading />}>
      <SignInForm />
    </Suspense>
  )
}
