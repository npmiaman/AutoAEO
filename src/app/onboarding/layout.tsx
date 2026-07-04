// Focused, full-screen onboarding — deliberately no dashboard nav/shell.
export default function OnboardingLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <div className="flex min-h-screen flex-col px-6">{children}</div>
  );
}
