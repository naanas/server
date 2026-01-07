export interface Task {
    date: string; // YYYY-MM-DD
    description: string;
    ticketNumber: string; // e.g., BATB-17584
    ticketLink: string;
  }
  
  export interface EmployeeData {
    name: string;
    position: string;
    periodStart: string;
    periodEnd: string;
  }