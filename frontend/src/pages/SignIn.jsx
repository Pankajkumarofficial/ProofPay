import { useEffect, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { ArrowRight } from 'lucide-react';
import { AuthLayout } from '../layouts/AuthLayout.jsx';
import { Button } from '../components/UI/Button.jsx';
import { Input } from '../components/UI/Field.jsx';
import { GoogleButton } from '../components/UI/GoogleButton.jsx';
import { useAuth } from '../context/AuthContext.jsx';
import { useToast } from '../context/ToastContext.jsx';

const schema = z.object({
  email: z.string().trim().min(1, 'Enter your email.').email('That email does not look right.'),
  password: z.string().min(1, 'Enter your password.'),
});

export function SignIn() {
  const { signIn, config, isAuthenticated } = useAuth();
  const navigate = useNavigate();
  const toast = useToast();
  const [params] = useSearchParams();
  const [formError, setFormError] = useState(null);

  const {
    register,
    handleSubmit,
    setError,
    formState: { errors, isSubmitting },
  } = useForm({ resolver: zodResolver(schema), defaultValues: { email: '', password: '' } });

  useEffect(() => {
    if (isAuthenticated) navigate('/space', { replace: true });
  }, [isAuthenticated, navigate]);

  useEffect(() => {
    const message = params.get('error');
    if (message) toast.error('Sign-in did not complete', message);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [params]);

  const onSubmit = async (values) => {
    setFormError(null);
    try {
      await signIn(values);
      navigate('/space', { replace: true });
    } catch (error) {
      const fields = error.fieldErrors ?? {};
      const entries = Object.entries(fields);
      if (entries.length) entries.forEach(([field, message]) => setError(field, { message }));
      else setFormError(error.message);
    }
  };

  return (
    <AuthLayout>
      <div className="lg:hidden">
        <Link to="/" className="font-display text-[22px] text-paper-50">
          ProofPay
        </Link>
      </div>

      <p className="label mt-8 lg:mt-0">Sign in</p>
      <h1 className="mt-2 font-display text-[30px] leading-tight tracking-tight text-paper-50">Welcome back.</h1>
      <p className="mt-2 text-[13px] leading-relaxed text-paper-300">
        Your Promise Space is exactly where you left it.
      </p>

      {config?.google ? (
        <>
          <GoogleButton className="mt-7" intent="signin" />
          <div className="my-6 flex items-center gap-3">
            <span className="h-px flex-1 bg-ink-300" />
            <span className="label">or</span>
            <span className="h-px flex-1 bg-ink-300" />
          </div>
        </>
      ) : (
        <div className="mt-7" />
      )}

      <form onSubmit={handleSubmit(onSubmit)} className="space-y-4" noValidate>
        <Input
          label="Email"
          type="email"
          autoComplete="email"
          placeholder="you@example.com"
          error={errors.email?.message}
          {...register('email')}
        />
        <Input
          label="Password"
          type="password"
          autoComplete="current-password"
          placeholder="••••••••"
          error={errors.password?.message}
          {...register('password')}
        />

        {formError ? (
          <p className="border border-rust-400/40 bg-rust-400/5 px-3 py-2.5 text-[12px] leading-relaxed text-rust-300">
            {formError}
          </p>
        ) : null}

        <Button type="submit" variant="primary" size="lg" loading={isSubmitting} icon={ArrowRight} className="w-full">
          Sign in
        </Button>
      </form>

      <p className="mt-6 text-[12px] text-paper-400">
        Don’t have an account?{' '}
        <Link to="/signup" className="text-brass-200 underline decoration-brass-300/30 underline-offset-4 hover:text-brass-100">
          Create your Promise Space
        </Link>
      </p>
    </AuthLayout>
  );
}
