/** Handle service pages and sign-in redirects without exposing JSON parser errors. */
export async function readApiResponse(response: Response): Promise<unknown> {
  if (response.status === 401) {
    throw new Error('Please refresh this page and sign in again to continue.');
  }
  if (response.status === 403) {
    throw new Error('Access could not be verified. Refresh this page and sign in with an invited account.');
  }

  const contentType = response.headers.get('content-type') || '';
  if (contentType.toLowerCase().includes('text/html')) {
    throw new Error('The connection returned a sign-in or service page. Refresh this page and sign in if prompted.');
  }

  let data: unknown;
  try {
    data = await response.json();
  } catch {
    throw new Error('The server response could not be read. Please refresh this page and try again.');
  }
  if (!data || typeof data !== 'object' || Array.isArray(data)) {
    throw new Error('The server returned an unexpected response. Please refresh this page and try again.');
  }
  return data;
}
