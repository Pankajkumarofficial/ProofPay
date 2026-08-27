import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { ArrowRight } from 'lucide-react';
import { AuthLayout } from '../layouts/AuthLayout.jsx';
import { Button } from '../components/UI/Button.jsx';
import { Input } from '../components/UI/Field.jsx';
import { GoogleButton } from '../components/UI/GoogleButton.jsx';
import { useAuth } from '../context/AuthContext.jsx';

const schema = z
  .object({
    name: z.string().trim().min(2, 'Tell us your name.').max(80),
    email: z.string().trim().min(1, 'Enter your email.').email('That email does not look right.'),
    password: z
      .string()
      .min(8, 'Use at least 8 characters.')
      .refine((value) => /[a-zA-Z]/.test(value) && /[0-9]/.test(value), 'Include a letter and a number.'),
    confirmPassword: z.string().min(1, 'Repeat your password.'),
  })
  .refine((values) => values.password === values.confirmPassword, {
    path: ['confirmPassword'],
    message: 'The two passwords do not match.',
  });

export function SignUp() {
  const { signUp, config, isAuthenticated } = useAuth();
  const navigate = useNavigate();
  const [formError, setFormError] = useState(null);

  const {
    register,
    handleSubmit,
    setError,
    formState: { errors, isSubmitting },
  } = useForm({
    resolver: zodResolver(schema),
    defaultValues: { name: '', email: '', password: '', confirmPassword: '' },
  });

  useEffect(() => {
    if (isAuthenticated) navigate('/space', { replace: true });
  }, [isAuthenticated, navigate]);

  const onSubmit = async (values) => {
    setFormError(null);
    try {
      await signUp(values);
      navigate('/space', { replace: true });
    } catch (error) {
      const entries = Object.entries(error.fieldErrors ?? {});
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

      <p className="eyebrow mt-8 lg:mt-0">Sign up</p>
      <h1 className="mt-2 font-display text-[30px] leading-tight tracking-tight text-paper-50">
        Create your Promise Space.
      </h1>
      <p className="mt-2 text-[13px] leading-relaxed text-paper-300">
        Describe what you are willing to pay for. The Proof Engine turns it into something measurable.
      </p>

      {config?.google ? (
        <>
          <GoogleButton className="mt-7" intent="signup" />
          <div className="my-6 flex items-center gap-3">
            <span className="h-px flex-1 bg-ink-300" />
            <span className="font-mono text-[10px] uppercase tracking-widest text-paper-400">or</span>
            <span className="h-px flex-1 bg-ink-300" />
          </div>
        </>
      ) : (
        <div className="mt-7" />
      )}

      <form onSubmit={handleSubmit(onSubmit)} className="space-y-4" noValidate>
        <Input label="Name" autoComplete="name" placeholder="Your name" error={errors.name?.message} {...register('name')} />
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
          autoComplete="new-password"
          hint="8+ characters"
          placeholder="••••••••"
          error={errors.password?.message}
          {...register('password')}
        />
        <Input
          label="Confirm password"
          type="password"
          autoComplete="new-password"
          placeholder="••••••••"
          error={errors.confirmPassword?.message}
          {...register('confirmPassword')}
        />

        {formError ? (
          <p className="border border-rust-400/40 bg-rust-400/5 px-3 py-2.5 text-[12px] leading-relaxed text-rust-300">
            {formError}
          </p>
        ) : null}

        <Button type="submit" variant="primary" size="lg" loading={isSubmitting} icon={ArrowRight} className="w-full">
          Create account
        </Button>
      </form>

      <p className="mt-6 text-[12px] text-paper-400">
        Already have an account?{' '}
        <Link to="/signin" className="text-brass-200 underline decoration-brass-300/30 underline-offset-4 hover:text-brass-100">
          Sign in
        </Link>
      </p>
    </AuthLayout>
  );
}
