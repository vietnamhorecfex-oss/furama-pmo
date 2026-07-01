import { Spinner } from '@/components/Spinner';

export default function RootLoading() {
  return (
    <div className="min-h-screen grid place-items-center">
      <Spinner className="h-8 w-8" />
    </div>
  );
}
