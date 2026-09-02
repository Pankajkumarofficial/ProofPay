import { Link } from 'react-router-dom';

export function NotFound() {
  return (
    <div className="flex min-h-[70vh] flex-col items-center justify-center px-6 text-center">
      <p className="label">404</p>
      <h1 className="mt-4 max-w-md text-balance font-display text-[30px] leading-tight text-paper-50">
        There is no promise at this address.
      </h1>
      <p className="mt-3 max-w-sm text-[13px] leading-relaxed text-paper-300">
        The link may be old, or the promise may belong to someone else.
      </p>
      <Link to="/space" className="btn-primary mt-7 px-5 py-3">
        Back to Promise Space
      </Link>
    </div>
  );
}
