# Phoenix Capital Executive Dashboard

A modern, responsive React web application for managing and monitoring business units across Phoenix Capital's portfolio.

## 🚀 Features

- **Collapsible Sidebar Navigation**: Expandable sections for different business units
- **Multi-Unit Management**: Support for Logbook, Zidisha, Advans, Kajea-Tech, and Insurance
- **Responsive Design**: Optimized for desktop and tablet viewing
- **Modern UI**: Clean, minimalistic design with soft colors and smooth animations
- **Real-time Navigation**: Dynamic routing with React Router DOM
- **Comprehensive Dashboards**: Detailed metrics and analytics for each business unit

## 🏗️ Business Units

### Logbook
- Dashboard
- Disbursement
- Collection
- PAR (Portfolio at Risk)
- Productivity

### Zidisha
- Dashboard
- Disbursement
- Collection
- PAR (Portfolio at Risk)
- Productivity

### Advans
- Dashboard
- Disbursement
- Collection
- PAR (Portfolio at Risk)
- Productivity

### Kajea - Tech
- Number of Clients

### Insurance
- Dashboard

## 🛠️ Technology Stack

- **React 18** - Modern React with functional components and hooks
- **Vite** - Fast build tool and development server
- **Tailwind CSS** - Utility-first CSS framework
- **React Router DOM** - Client-side routing
- **Lucide React** - Beautiful, customizable icons

## 📁 Project Structure

```
src/
├── components/
│   ├── Sidebar.jsx          # Collapsible navigation sidebar
│   ├── Layout.jsx           # Main application layout
│   └── Header.jsx           # Top navigation header
├── pages/
│   ├── logbook/             # Logbook business unit pages
│   ├── zidisha/             # Zidisha business unit pages
│   ├── advans/              # Advans business unit pages
│   ├── kajea/               # Kajea-Tech pages
│   └── insurance/           # Insurance business unit pages
├── routes.jsx               # Application routing configuration
├── App.jsx                  # Main application component
└── main.jsx                 # Application entry point
```

## 🚀 Getting Started

### Prerequisites

- Node.js (version 16 or higher)
- npm or yarn

### Installation

1. Clone the repository:
```bash
git clone <repository-url>
cd phoenix-capital-dashboard
```

2. Install dependencies:
```bash
npm install
```

3. Start the development server:
```bash
npm run dev
```

4. Open your browser and navigate to `http://localhost:5173`

### Building for Production

```bash
npm run build
```

The built files will be in the `dist` directory.

## 🎨 Design System

The application follows a modern design system with:

- **Color Palette**: Neutral grays and blues with primary accent colors
- **Typography**: Clean, accessible font hierarchy
- **Spacing**: Consistent spacing using Tailwind's spacing scale
- **Shadows**: Soft shadows for depth and hierarchy
- **Animations**: Smooth transitions and hover effects

## 🔧 Customization

### Adding New Business Units

1. Create a new folder in `src/pages/`
2. Add your page components
3. Update `src/routes.jsx` with new routes
4. Add navigation items to `src/components/Sidebar.jsx`

### Styling

The application uses Tailwind CSS with custom components defined in `src/style.css`. You can:

- Modify the color palette in `tailwind.config.js`
- Add custom components in the `@layer components` section
- Override base styles in the `@layer base` section

## 🚀 Future Enhancements

- [ ] Real-time data integration with APIs (Loandisk, Musoni, etc.)
- [ ] User authentication and role-based access
- [ ] Dark mode toggle
- [ ] Real-time notifications and alerts
- [ ] Export functionality (Excel/PDF)
- [ ] Advanced analytics and reporting
- [ ] Mobile app version

## 📱 Responsive Design

The dashboard is fully responsive and optimized for:

- **Desktop**: Full sidebar with expanded navigation
- **Tablet**: Collapsible sidebar with touch-friendly interface
- **Mobile**: Optimized layout (future enhancement)

## 🤝 Contributing

1. Fork the repository
2. Create a feature branch
3. Make your changes
4. Test thoroughly
5. Submit a pull request

## 📄 License

This project is proprietary software owned by Phoenix Capital.

## 📞 Support

For technical support or questions, please contact the development team.

---

Built with ❤️ for Phoenix Capital
