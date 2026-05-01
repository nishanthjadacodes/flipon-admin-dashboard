# Admin Dashboard - Platform Control Center

A comprehensive admin dashboard built with Next.js and JavaScript that serves as the central operating system for a service platform management system.

## Features

### 1. Dashboard Overview
- **Business Metrics**: Daily total bookings, active field agents, gross revenue summary, pending actions
- **Operational Alerts**: Real-time notifications for low-performance agents and operational issues
- **Pending Action Visibility**: Clear overview of tasks requiring attention
- **Performance Summary**: Visual progress bars for key business metrics
- **Quick Actions**: One-click access to common administrative tasks

### 2. Order Management
- **Structured Workflow**: Order review customer detail verification manual assignment override order tracking across stages
- **Order Verification**: Manual review and approval process for incoming orders
- **Agent Assignment**: Manual override with agent availability and ratings visibility
- **Order Tracking**: Multi-stage progress visualization from placement to completion
- **Document Access**: View customer-uploaded documents for service processing

### 3. Partner / Agent Management
- **Agent Onboarding**: Add/remove agents with approval workflow
- **KYC Management**: Upload and manage agent KYC documents with verification status
- **Performance Tracking**: Comprehensive metrics (ratings completion time revenue)
- **Payout Tracking**: Bank details payment history pending amounts
- **Agent Status Management**: Active/inactive control with performance monitoring

### 4. Service Management
- **Service Catalog**: Add/edit services with dynamic pricing updates
- **Pricing Rules**: Conditional pricing based on size urgency frequency
- **Document Management**: Access customer-uploaded records for service processing
- **Service Performance**: Revenue and order tracking per service
- **Service Editor**: Improved interface for service management

### 5. Customer Support Admin (Helpdesk Access)
- **View History**: Access to customer booking history and basic contact information
- **Ticketing System**: Create and update "Help Tickets" for user grievances
- **In-App Communication**: Communication with customers and agents via integrated chat/call system
- **Customer History**: Detailed view with restrictions (no financial data access)
- **Communication Tracking**: Email call and chat history management

### 6. Essential Reports & Analytics
- **Daily Operational Report**: Summary of total bookings completed tasks and cancellations
- **Agent Performance Report**: Tracks agent ratings average completion time and task volume
- **Revenue Summary (B2C vs B2B)**: Comparative analysis of earnings from household services versus industrial contracts
- **Service Demand Heatmap**: Identifies high-demand zones for optimizing agent deployment
- **Pending Documentation Report**: Lists applications stalled due to missing or rejected government documents

### 7. Admin UX / Controls
- **Role-Based Access Control (RBAC)**: Different access rights based on user roles
- **Notification System**: Indicator for new bookings and system alerts
- **User Management**: Add/edit admin users with permission assignments
- **Notification Settings**: Configurable email push and SMS preferences

## User Roles and Permissions

### Super Admin
- **Full Access**: All modules and features
- **User Management**: Can add/edit all user roles
- **System Settings**: Complete administrative control
- **Financial Data**: Full access to all financial information

### Admin
- **Core Operations**: Dashboard orders agents services reports helpdesk
- **User Management**: Can manage operators and customer support users
- **Business Oversight**: Full operational visibility except system settings
- **Financial Access**: Complete financial data access

### Customer Support
- **Helpdesk Access**: Full customer support functionality
- **Customer History**: View booking history and contact information
- **Ticket Management**: Create and manage help tickets
- **Communication**: In-app chat and call system access
- **Reports**: Access to essential reports and analytics
- **Restrictions**: No delete permissions no financial data access no admin settings

### Operator
- **Order Management**: Full order processing capabilities
- **Dashboard Access**: Business overview and metrics
- **Limited Scope**: No access to agents services or admin controls
- **Operational Focus**: Day-to-day order processing

### Viewer
- **Read-Only Access**: Dashboard and reports viewing
- **Analytics**: Business intelligence and reporting
- **No Actions**: Cannot modify or create data
- **Monitoring**: Business health monitoring only

## Technology Stack

- **Frontend**: Next.js 16.2.3 with JavaScript
- **Styling**: Tailwind CSS v4
- **UI Components**: Custom components with responsive design
- **Icons**: Emoji icons and SVG elements
- **State Management**: React hooks (useState useEffect)
- **Routing**: Next.js App Router

## Getting Started

### Prerequisites
- Node.js 18+ 
- npm yarn pnpm or bun

### Installation

1. Clone the repository
2. Install dependencies:
```bash
npm install
# or
yarn install
# or
pnpm install
# or
bun install
```

### Development

Run the development server:

```bash
npm run dev
# or
yarn dev
# or
pnpm dev
# or
bun dev
```

Open [http://localhost:3000](http://localhost:3000) with your browser to see the result.

### Production Build

```bash
npm run build
npm start
```

## Project Structure

```
admindashboard/
|-- app/
|   |-- globals.css          # Global styles and responsive design
|   |-- layout.js            # Root layout component
|   |-- page.js              # Main dashboard page
|-- components/
|   |-- Sidebar.js           # Navigation sidebar with RBAC
|   |-- DashboardOverview.js # Business metrics and alerts
|   |-- OrderManagement.js   # Order processing and tracking
|   |-- AgentManagement.js   # Agent onboarding and performance
|   |-- ServiceManagement.js # Service catalog and pricing
|   |-- Helpdesk.js          # Customer support and ticketing
|   |-- Reports.js           # Analytics and reporting
|   |-- AdminControls.js     # User management and settings
|-- public/                  # Static assets
|-- package.json            # Dependencies and scripts
```

## Key Features Implementation

### Responsive Design
- Mobile-first approach with collapsible sidebar
- Touch-friendly interface for tablets and phones
- Adaptive layouts for all screen sizes
- Custom scrollbar styles and animations

### Security & Permissions
- Role-based access control throughout the application
- Data access restrictions based on user roles
- Secure navigation with permission checks
- Customer support role with limited financial access

### Performance
- Optimized component rendering with React hooks
- Efficient state management
- Lazy loading potential for large datasets
- Smooth animations and transitions

### User Experience
- Intuitive navigation with clear visual hierarchy
- Real-time updates and notifications
- Comprehensive search and filtering
- Export functionality for reports

## Admin Guidelines

### Customer Support Team Rules
- **View History**: Access to customer booking history and basic contact information only
- **Ticketing System**: Can create and update help tickets for user grievances
- **In-App Communication**: Communicate with customers and agents via integrated chat/call system
- **Restrictions**: No delete permissions no access to financial data no access to administrative settings

### Reporting Guidelines
- **Daily Operational Report**: Auto-generated summary of daily business activities
- **Agent Performance Report**: Track individual and team performance metrics
- **Revenue Analysis**: Separate B2C and B2B revenue tracking
- **Demand Analysis**: Service demand heatmap for operational optimization
- **Documentation Tracking**: Monitor pending documentation issues

## Deployment

### Vercel (Recommended)
The easiest way to deploy is using the [Vercel Platform](https://vercel.com/new?utm_medium=default-template&filter=next.js&utm_source=create-next-app&utm_campaign=create-next-app-readme).

### Other Platforms
The application can be deployed to any platform supporting Next.js applications.

## Support

For technical support or questions about the admin dashboard implementation please refer to the documentation or contact the development team.

## License

This project is proprietary and should not be distributed without permission.
