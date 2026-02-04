/**
 * Allowed email domains for selected institutions (sign-up validation).
 * Key: institution display_name (as from OpenAlex). Value: allowed domains (lowercase).
 * Add more entries as needed; we match case-insensitively on institution name.
 */
export const INSTITUTION_EMAIL_DOMAINS: Record<string, string[]> = {
  'Cornell University': ['cornell.edu'],
  'Harvard University': ['harvard.edu', 'harvard.edu.uk'],
  'Stanford University': ['stanford.edu'],
  'MIT': ['mit.edu'],
  'Massachusetts Institute of Technology': ['mit.edu'],
  'Yale University': ['yale.edu'],
  'Princeton University': ['princeton.edu'],
  'Columbia University': ['columbia.edu'],
  'University of Pennsylvania': ['upenn.edu', 'pennmedicine.upenn.edu'],
  'University of California, Berkeley': ['berkeley.edu'],
  'University of California, Los Angeles': ['ucla.edu'],
  'University of Michigan': ['umich.edu'],
  'University of Washington': ['uw.edu', 'u.washington.edu'],
  'Duke University': ['duke.edu'],
  'Northwestern University': ['northwestern.edu'],
  'University of Chicago': ['uchicago.edu'],
  'Johns Hopkins University': ['jhu.edu', 'jhmi.edu'],
  'University of Texas at Austin': ['utexas.edu'],
  'University of Wisconsin-Madison': ['wisc.edu'],
  'University of North Carolina at Chapel Hill': ['unc.edu'],
  'Ohio State University': ['osu.edu'],
  'Penn State University': ['psu.edu'],
  'University of Florida': ['ufl.edu'],
  'University of Minnesota': ['umn.edu'],
  'University of Illinois at Urbana-Champaign': ['illinois.edu'],
  'University of Maryland': ['umd.edu'],
  'University of Pittsburgh': ['pitt.edu'],
  'University of Colorado Boulder': ['colorado.edu'],
  'University of Southern California': ['usc.edu'],
  'New York University': ['nyu.edu'],
  'Carnegie Mellon University': ['andrew.cmu.edu', 'cmu.edu'],
  'Georgia Institute of Technology': ['gatech.edu'],
  'University of California, San Diego': ['ucsd.edu'],
  'University of California, San Francisco': ['ucsf.edu'],
  'University of Virginia': ['virginia.edu'],
  'Brown University': ['brown.edu'],
  'Dartmouth College': ['dartmouth.edu'],
  'Vanderbilt University': ['vanderbilt.edu'],
  'Rice University': ['rice.edu'],
  'Emory University': ['emory.edu'],
  'University of Rochester': ['rochester.edu'],
  'Boston University': ['bu.edu'],
  'University of Arizona': ['arizona.edu'],
  'Purdue University': ['purdue.edu'],
  'Texas A&M University': ['tamu.edu'],
  'University of Iowa': ['uiowa.edu'],
  'Michigan State University': ['msu.edu'],
  'University of Utah': ['utah.edu'],
  'University of Oregon': ['uoregon.edu'],
  'University of British Columbia': ['ubc.ca'],
  'University of Toronto': ['utoronto.ca'],
  'McGill University': ['mcgill.ca'],
  'University of Cambridge': ['cam.ac.uk'],
  'University of Oxford': ['ox.ac.uk'],
  'Imperial College London': ['imperial.ac.uk'],
  'ETH Zurich': ['ethz.ch'],
  'University of Melbourne': ['unimelb.edu.au'],
  'University of Sydney': ['sydney.edu.au'],
}

/**
 * Normalize institution name for lookup (lowercase, trim).
 */
function normalizeInstitution(name: string): string {
  return name.trim().toLowerCase();
}

/**
 * Get allowed email domains for an institution (if known).
 */
export function getAllowedDomainsForInstitution(institutionName: string): string[] | null {
  const normalized = normalizeInstitution(institutionName);
  for (const [key, domains] of Object.entries(INSTITUTION_EMAIL_DOMAINS)) {
    if (normalizeInstitution(key) === normalized) return domains;
  }
  return null;
}

/**
 * Check if an email domain is allowed for the given institution.
 */
export function isEmailDomainAllowedForInstitution(
  email: string,
  institutionName: string
): { allowed: boolean; message?: string } {
  const domain = email.split('@')[1]?.toLowerCase();
  if (!domain) {
    return { allowed: false, message: 'Please enter a valid email address.' };
  }

  const allowed = getAllowedDomainsForInstitution(institutionName);
  if (!allowed) {
    return {
      allowed: true,
      message: 'Use your institution email when possible (e.g. name@university.edu).',
    };
  }

  const domainAllowed = allowed.some((d) => domain === d || domain.endsWith('.' + d));
  if (!domainAllowed) {
    return {
      allowed: false,
      message: `Please use your institution email. For ${institutionName}, use an address ending with: ${allowed.map((d) => '@' + d).join(' or ')}`,
    };
  }
  return { allowed: true };
}
