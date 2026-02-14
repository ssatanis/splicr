'use client'

import { useState, useEffect, useMemo } from 'react'
import Link from 'next/link'
import Image from 'next/image'
import { Eye, EyeOff } from 'lucide-react'
import InstitutionAutocomplete from '@/components/InstitutionAutocomplete'
import { isEmailDomainAllowedForInstitution, getAllowedDomainsForInstitution } from '@/lib/institutionDomains'

const taglines = [
  'Join researchers worldwide',
  'Start analyzing in minutes',
  'Free for academic use',
  'No credit card required',
  'Built for discovery',
]

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
  const [showPassword, setShowPassword] = useState(false)
  const [showConfirmPassword, setShowConfirmPassword] = useState(false)
  const [labCode, setLabCode] = useState('')
  const [codeValidation, setCodeValidation] = useState<{
    valid: boolean | null
    lab?: { name: string; institution: string | null }
    error?: string
  }>({ valid: null })
  const [validatingCode, setValidatingCode] = useState(false)

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

  // Validate lab code with debounce
  useEffect(() => {
    if (!labCode.trim()) {
      setCodeValidation({ valid: null })
      return
    }

    const code = labCode.trim().toUpperCase()

    // Basic format validation
    if (!/^[A-Z0-9]{1,6}$/.test(code)) {
      setCodeValidation({ valid: false, error: 'Invalid format' })
      return
    }

    // Only validate if 6 characters
    if (code.length !== 6) {
      setCodeValidation({ valid: null })
      return
    }

    // Debounce API call
    const timer = setTimeout(async () => {
      setValidatingCode(true)
      try {
        const response = await fetch('/api/labs/validate-code', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ invite_code: code }),
        })

        const data = await response.json()
        setCodeValidation(data)
      } catch (error) {
        console.error('Code validation error:', error)
        setCodeValidation({ valid: false, error: 'Validation failed' })
      } finally {
        setValidatingCode(false)
      }
    }, 300)

    return () => clearTimeout(timer)
  }, [labCode])

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
      setError('The passwords you entered do not match.')
      return
    }

    if (password.length < 8) {
      setError('Your password must be at least 8 characters long.')
      return
    }

    if (!acceptTerms) {
      setError('Please accept the Terms of Service and Privacy Policy to continue.')
      return
    }

    if (!institution?.trim()) {
      setError('Please select your college or university from the dropdown.')
      return
    }

    const emailCheck = isEmailDomainAllowedForInstitution(email.trim(), institution.trim())
    if (!emailCheck.allowed) {
      setError(emailCheck.message ?? 'Please use your institutional email address.')
      return
    }

    setLoading(true)
    setError('')

    try {
      // Use server-side auth endpoint to bypass CORS issues
      const response = await fetch('/api/auth/signup', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          email,
          password,
          fullName,
          institution: institution.trim(),
          lab_invite_code: labCode.trim() || undefined,
        }),
      })

      // Check if response is JSON before parsing
      const contentType = response.headers.get('content-type')
      if (!contentType || !contentType.includes('application/json')) {
        setError('We couldn\'t reach the server. Please check your connection and try again.')
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
        setError(data?.error || 'Unable to create your account. Please try again.')
        return
      }

      // Success - show email confirmation message
      setSuccess(true)
    } catch (err) {
      console.error('Sign-up error:', err)
      if (err instanceof TypeError && err.message.includes('fetch')) {
        setError('We couldn\'t reach the server. Please check your connection and try again.')
      } else {
        setError('Something went wrong. Please try again.')
      }
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
              className={`text-text-secondary font-serif text-sm h-5 transition-opacity duration-500 ${taglineFading ? 'opacity-0' : 'opacity-100'
                }`}
            >
              {taglines[taglineIndex]}
            </p>
          </div>

          {/* Error Message - right under header, above form */}
          {error && (
            <div className="mb-5 rounded-xl border border-red-200 bg-red-50 px-4 py-3">
              <p className="text-sm text-red-800">{error}</p>
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

            {/* Lab Invite Code (Optional) */}
            <div>
              <label className="block text-sm font-serif text-text-secondary mb-2">
                Lab Invite Code <span className="text-text-tertiary">(Optional)</span>
              </label>
              <input
                type="text"
                value={labCode}
                onChange={(e) => setLabCode(e.target.value.toUpperCase())}
                maxLength={6}
                className={`w-full px-4 py-3 bg-white border rounded-xl font-serif text-text-primary placeholder:text-text-tertiary focus:outline-none focus:ring-2 focus:ring-accent/30 transition-all uppercase ${codeValidation.valid === false
                  ? 'border-error focus:border-error focus:ring-error/30'
                  : 'border-border focus:border-accent'
                  }`}
                placeholder="ABC123"
              />
              {validatingCode && (
                <p className="mt-1.5 text-xs text-text-tertiary flex items-center gap-1">
                  <svg className="w-3 h-3 animate-spin" fill="none" viewBox="0 0 24 24">
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
                  </svg>
                  Validating code...
                </p>
              )}
              {codeValidation.valid && codeValidation.lab && (
                <p className="mt-1.5 text-xs text-success flex items-center gap-1">
                  <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                  </svg>
                  You&apos;ll join: {codeValidation.lab.name}
                </p>
              )}
              {codeValidation.valid === false && codeValidation.error && (
                <p className="mt-1.5 text-xs text-error">{codeValidation.error}</p>
              )}
              <p className="mt-1.5 text-xs text-text-tertiary font-serif">
                Have a lab code? Join your team instantly upon sign up.
              </p>
            </div>

            <div>
              <label className="block text-sm font-serif text-text-secondary mb-2">
                Password
              </label>
              <div className="relative">
                <input
                  type={showPassword ? 'text' : 'password'}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  required
                  autoComplete="new-password"
                  className="w-full px-4 py-3 pr-11 bg-white border border-border rounded-xl font-serif text-text-primary placeholder:text-text-tertiary focus:outline-none focus:ring-2 focus:ring-accent/30 focus:border-accent transition-all"
                  placeholder="At least 8 characters"
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
              <div className="relative">
                <input
                  type={showConfirmPassword ? 'text' : 'password'}
                  value={confirmPassword}
                  onChange={(e) => setConfirmPassword(e.target.value)}
                  required
                  autoComplete="new-password"
                  className={`w-full px-4 py-3 pr-11 bg-white border rounded-xl font-serif text-text-primary placeholder:text-text-tertiary focus:outline-none focus:ring-2 focus:ring-accent/30 transition-all ${confirmPassword && password !== confirmPassword
                    ? 'border-error focus:border-error focus:ring-error/30'
                    : 'border-border focus:border-accent'
                    }`}
                  placeholder="Confirm your password"
                />
                <button
                  type="button"
                  onClick={() => setShowConfirmPassword((p) => !p)}
                  className="absolute right-2.5 top-1/2 -translate-y-1/2 p-1.5 rounded-lg text-text-tertiary hover:text-text-primary hover:bg-black/5 transition-colors focus:outline-none focus:ring-2 focus:ring-accent/30 focus:ring-offset-0"
                  aria-label={showConfirmPassword ? 'Hide password' : 'Show password'}
                  tabIndex={-1}
                >
                  {showConfirmPassword ? (
                    <EyeOff className="w-4 h-4" strokeWidth={1.5} />
                  ) : (
                    <Eye className="w-4 h-4" strokeWidth={1.5} />
                  )}
                </button>
              </div>
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
                <a
                  href="https://splicr.org/terms-and-conditions"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-accent hover:underline"
                >
                  Terms & Conditions
                </a>{' '}
                and{' '}
                <a
                  href="https://splicr.org/privacy-and-security"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-accent hover:underline"
                >
                  Privacy & Security
                </a>
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

        {/* Footer Disclaimer */}
        <div className="mt-8 text-center space-y-3">
          <p className="text-xs text-text-tertiary font-serif max-w-md mx-auto">
            Your privacy and security are important to us. SplicR is committed to protecting your data.
          </p>
          <div className="flex items-center justify-center gap-3 text-xs">
            <a
              href="https://splicr.org/privacy-and-security"
              target="_blank"
              rel="noopener noreferrer"
              className="text-text-tertiary hover:text-text-secondary transition-colors font-serif"
            >
              Privacy & Security
            </a>
            <span className="text-border">•</span>
            <a
              href="https://splicr.org/terms-and-conditions"
              target="_blank"
              rel="noopener noreferrer"
              className="text-text-tertiary hover:text-text-secondary transition-colors font-serif"
            >
              Terms & Conditions
            </a>
          </div>
        </div>
      </div>

    </div>
  )
}
