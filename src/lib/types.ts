export type Workspace = {
  userId: string;
  userName: string | null;
  userEmail: string;
  role: string;
  company: {
    id: string;
    name: string;
    locale: string;
    baseCurrency: string;
    fiscalYearStartMonth: number;
  };
};
