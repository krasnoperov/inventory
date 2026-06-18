import { HeaderNav } from 'makefx';
export const WithName = () => <HeaderNav userName="Ada Lovelace" userEmail="ada@example.com" />;
export const EmailOnly = () => <HeaderNav userName={null} userEmail="ada@example.com" />;
