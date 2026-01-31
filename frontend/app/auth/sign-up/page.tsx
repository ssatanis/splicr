'use client'

import { useState, useEffect, useMemo } from 'react'
import Link from 'next/link'
import Image from 'next/image'
import { createClient } from '@/lib/supabase/client'
import InstitutionAutocomplete from '@/components/InstitutionAutocomplete'
import { isEmailDomainAllowedForInstitution, getAllowedDomainsForInstitution } from '@/lib/institutionDomains'

const taglines = [
  'Join researchers worldwide',
  'Start analyzing in minutes',
  'Free for academic use',
  'No credit card required',
  'Built for discovery',
]

function normalizeAuthError(message: string): string {
  const lower = message.toLowerCase()
  if (lower.includes('invalid') && (lower.includes('api key') || lower.includes('key'))) {
    return [
      'Supabase rejected your API key.',
      'In frontend/.env.local set NEXT_PUBLIC_PUBLISHABLE_KEY to your Client Key (sb_publishable_...) from Supabase Dashboard → Project Settings → API, or set NEXT_PUBLIC_SUPABASE_ANON_KEY to the anon JWT. Then run: rm -rf .next && npm run dev',
    ].join(' ')
  }
  if (lower.includes('already registered') || lower.includes('already exists')) {
    return 'An account with this email already exists.'
  }
  if (lower.includes('signup_disabled')) {
    return 'New sign-ups are currently disabled.'
  }
  return message
}

export default function SignUpPage() {
  const [fullName, setFullName] = useState('')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [institution, setInstitution] = useState('')
  const [acceptTerms, setAcceptTerms] = useState(false)
  const [error, setError] = useState('')
  const [success, setSuccess] = useState(false)
  const [loading, setLoading] = useState(false)
  const [taglineIndex, setTaglineIndex] = useState(0)
  const [taglineFading, setTaglineFading] = useState(false)

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

  // Password strength indicator
  const passwordStrength = useMemo(() => {
    if (!password) return { score: 0, label: '', color: '' }

    let score = 0
    if (password.length >= 8) score++
    if (password.length >= 12) score++
    if (/[A-Z]/.test(password)) score++
    if (/[a-z]/.test(password)) score++
    if (/[0-9]/.test(password)) score++
    if (/[^A-Za-z0-9]/.test(password)) score++

    if (score <= 2) return { score: 1, label: 'Weak', color: 'bg-error' }
    if (score <= 4) return { score: 2, label: 'Fair', color: 'bg-warning' }
    return { score: 3, label: 'Strong', color: 'bg-success' }
  }, [password])

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError('')

    // Validation
    if (password !== confirmPassword) {
      setError('Passwords do not match')
      return
    }

    if (password.length < 8) {
      setError('Password must be at least 8 characters')
      return
    }

    if (!acceptTerms) {
      setError('Please accept the terms of service')
      return
    }

    if (!institution?.trim()) {
      setError('Please select your college or university')
      return
    }

    const emailCheck = isEmailDomainAllowedForInstitution(email.trim(), institution.trim())
    if (!emailCheck.allowed) {
      setError(emailCheck.message ?? 'Please use your institution email address.')
      return
    }

    setLoading(true)
    setError('')

    try {
      const supabase = createClient()
      const { data, error: signUpError } = await supabase.auth.signUp({
        email,
        password,
        options: {
          data: {
            full_name: fullName,
            institution: institution.trim(),
          },
          emailRedirectTo: `${window.location.origin}/auth/callback`,
        },
      })

      if (signUpError) {
        setError(normalizeAuthError(signUpError.message))
        return
      }

      if (data.user) {
        // Check if email confirmation is required
        if (data.user.identities?.length === 0) {
          setError('An account with this email already exists')
          return
        }

        // Save institution (and profile) to database so it persists per user
        await supabase
          .from('profiles')
          .upsert(
            {
              id: data.user.id,
              email: data.user.email ?? email,
              full_name: fullName.trim() || null,
              institution: institution.trim() || null,
              updated_at: new Date().toISOString(),
            },
            { onConflict: 'id' }
          )

        setSuccess(true)
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'An unexpected error occurred')
    } finally {
      setLoading(false)
    }
  }

  // Success state
  if (success) {
    return (
      <div className="min-h-screen bg-white flex items-center justify-center px-4">
        <div className="w-full max-w-md">
          <div className="bg-white rounded-2xl shadow-elevated p-8 md:p-10 border border-border-light text-center">
            <div className="w-16 h-16 bg-success/10 rounded-full flex items-center justify-center mx-auto mb-6">
              <svg
                className="w-8 h-8 text-success"
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M5 13l4 4L19 7"
                />
              </svg>
            </div>
            <h1 className="text-2xl font-serif text-text-primary mb-3">Check your email</h1>
            <p className="text-text-secondary font-serif mb-6">
              We&apos;ve sent a confirmation link to <strong>{email}</strong>. Click the link to
              verify your account.
            </p>
            <p className="text-sm text-text-tertiary font-serif mb-8">
              Didn&apos;t receive an email? Check your spam folder or{' '}
              <button
                onClick={() => setSuccess(false)}
                className="text-accent hover:underline"
              >
                try again
              </button>
            </p>
            <Link
              href="/auth/sign-in"
              className="inline-flex items-center gap-2 text-sm font-serif text-text-secondary hover:text-accent transition-colors"
            >
              <svg
                className="w-4 h-4"
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M10 19l-7-7m0 0l7-7m-7 7h18"
                />
              </svg>
              Back to sign in
            </Link>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-white flex items-center justify-center px-4 py-12">
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
            <h1 className="text-3xl font-serif text-text-primary mb-3">Create account</h1>
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
            <div className="mb-6 p-4 bg-error/5 border border-error/20 rounded-xl animate-fadeIn">
              <p className="text-error text-sm font-serif text-center whitespace-pre-wrap">{error}</p>
            </div>
          )}

          {/* Form */}
          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <label className="block text-sm font-serif text-text-secondary mb-2">
                Full name
              </label>
              <input
                type="text"
                value={fullName}
                onChange={(e) => setFullName(e.target.value)}
                required
                autoComplete="name"
                className="w-full px-4 py-3 bg-white border border-border rounded-xl font-serif text-text-primary placeholder:text-text-tertiary focus:outline-none focus:ring-2 focus:ring-accent/30 focus:border-accent transition-all"
                placeholder="Jane Smith"
              />
            </div>

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
                placeholder={
                  institution.trim()
                    ? getAllowedDomainsForInstitution(institution.trim())?.[0]
                      ? `e.g. you@${getAllowedDomainsForInstitution(institution.trim())![0]}`
                      : 'you@institution.edu'
                    : 'you@institution.edu'
                }
              />
              {institution.trim() && getAllowedDomainsForInstitution(institution.trim()) && (
                <p className="mt-1.5 text-xs text-text-tertiary font-serif">
                  Use your institution email (e.g. @{getAllowedDomainsForInstitution(institution.trim())!.join(' or @')})
                </p>
              )}
            </div>

            <div>
              <label className="block text-sm font-serif text-text-secondary mb-2">
                Institution <span className="text-error">*</span>
              </label>
              <InstitutionAutocomplete
                value={institution}
                onChange={setInstitution}
                required
                placeholder="Search for your college or university…"
                error={!!(error && error.includes('institution'))}
              />
            </div>

            <div>
              <label className="block text-sm font-serif text-text-secondary mb-2">
                Password
              </label>
              <input
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
                autoComplete="new-password"
                className="w-full px-4 py-3 bg-white border border-border rounded-xl font-serif text-text-primary placeholder:text-text-tertiary focus:outline-none focus:ring-2 focus:ring-accent/30 focus:border-accent transition-all"
                placeholder="At least 8 characters"
              />
              {password && (
                <div className="mt-2 flex items-center gap-2">
                  <div className="flex-1 h-1 bg-border-light rounded-full overflow-hidden">
                    <div
                      className={`h-full transition-all duration-300 ${passwordStrength.color}`}
                      style={{ width: `${(passwordStrength.score / 3) * 100}%` }}
                    />
                  </div>
                  <span className="text-xs font-serif text-text-tertiary">
                    {passwordStrength.label}
                  </span>
                </div>
              )}
            </div>

            <div>
              <label className="block text-sm font-serif text-text-secondary mb-2">
                Confirm password
              </label>
              <input
                type="password"
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
                required
                autoComplete="new-password"
                className={`w-full px-4 py-3 bg-white border rounded-xl font-serif text-text-primary placeholder:text-text-tertiary focus:outline-none focus:ring-2 focus:ring-accent/30 transition-all ${
                  confirmPassword && password !== confirmPassword
                    ? 'border-error focus:border-error focus:ring-error/30'
                    : 'border-border focus:border-accent'
                }`}
                placeholder="Confirm your password"
              />
            </div>

            {/* Terms Checkbox */}
            <div className="flex items-start gap-3 pt-2">
              <input
                type="checkbox"
                id="terms"
                checked={acceptTerms}
                onChange={(e) => setAcceptTerms(e.target.checked)}
                className="mt-1 w-4 h-4 rounded border-border text-accent focus:ring-accent/30"
              />
              <label htmlFor="terms" className="text-sm font-serif text-text-secondary">
                I agree to the{' '}
                <Link href="/terms" className="text-accent hover:underline">
                  Terms of Service
                </Link>{' '}
                and{' '}
                <Link href="/privacy" className="text-accent hover:underline">
                  Privacy Policy
                </Link>
              </label>
            </div>

            <button
              type="submit"
              disabled={loading || !institution.trim()}
              className="w-full py-3.5 bg-accent text-white font-serif font-medium rounded-xl hover:bg-accent/90 active:scale-[0.99] transition-all disabled:opacity-50 disabled:cursor-not-allowed shadow-sm mt-6"
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
                  Creating account...
                </span>
              ) : (
                'Create account'
              )}
            </button>
          </form>

          {/* Sign In Link */}
          <p className="mt-8 text-center text-sm font-serif text-text-secondary">
            Already have an account?{' '}
            <Link
              href="/auth/sign-in"
              className="text-accent hover:underline font-medium"
            >
              Sign in
            </Link>
          </p>
        </div>
      </div>

    </div>
  )
}
