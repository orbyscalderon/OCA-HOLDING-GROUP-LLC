/**
 * OCA Holding Group LLC — Datos estructurados del sitio
 * ------------------------------------------------------
 * INTEGRACIÓN CMS / BASE DE DATOS: estos arreglos simulan tablas del
 * backend. En producción, reemplazar OCA_DATA.services y OCA_DATA.news por
 * el resultado de fetch('/api/services') y fetch('/api/news') respectivamente,
 * manteniendo la misma forma de objeto (id, slug, type, es{...}, en{...}).
 *
 * Nota: `type` usa exactamente los mismos valores que el selector "Tipo de
 * proyecto" del formulario de cotización (ver contacto.html y
 * assets/js/translations.js -> contact.projectType*), para que el catálogo
 * de servicios y el brief de cotización hablen el mismo idioma.
 */
const OCA_DATA = {
  services: [
    {
      id: 1,
      slug: "sitios-web",
      type: "website",
      logoInitial: "W",
      es: {
        name: "Sitios Web Institucionales",
        tagline: "Presencia digital profesional para tu marca",
        description: "Diseño y desarrollo de sitios web corporativos, informativos y de marca personal — rápidos, responsivos y optimizados para buscadores.",
        keyFeatures: "Diseño a medida · SEO técnico · Panel de administración · Bilingüe · Soporte post-lanzamiento"
      },
      en: {
        name: "Institutional Websites",
        tagline: "A professional digital presence for your brand",
        description: "Design and development of corporate, informational, and personal-brand websites — fast, responsive, and optimized for search engines.",
        keyFeatures: "Custom design · Technical SEO · Admin panel · Bilingual · Post-launch support"
      }
    },
    {
      id: 2,
      slug: "aplicaciones-web",
      type: "webapp",
      logoInitial: "A",
      es: {
        name: "Aplicaciones Web",
        tagline: "Herramientas a medida para tu operación",
        description: "Plataformas web interactivas — paneles de control, portales de clientes, sistemas internos — construidas para resolver procesos específicos de tu negocio.",
        keyFeatures: "Autenticación de usuarios · Datos en tiempo real · Integraciones con terceros · Paneles administrativos"
      },
      en: {
        name: "Web Applications",
        tagline: "Custom tools built for your operation",
        description: "Interactive web platforms — dashboards, client portals, internal systems — built to solve the specific processes your business runs on.",
        keyFeatures: "User authentication · Real-time data · Third-party integrations · Admin dashboards"
      }
    },
    {
      id: 3,
      slug: "aplicaciones-moviles",
      type: "mobileapp",
      logoInitial: "M",
      es: {
        name: "Aplicaciones Móviles",
        tagline: "Tu negocio en el bolsillo de tus usuarios",
        description: "Apps nativas e híbridas para iOS y Android, desde MVPs hasta productos completos listos para las tiendas de aplicaciones.",
        keyFeatures: "Diseño UX/UI móvil · Notificaciones push · Publicación en App Store y Google Play"
      },
      en: {
        name: "Mobile Applications",
        tagline: "Your business, in your users' pocket",
        description: "Native and hybrid apps for iOS and Android, from MVPs to full products ready for the app stores.",
        keyFeatures: "Mobile UX/UI design · Push notifications · App Store & Google Play publishing"
      }
    },
    {
      id: 4,
      slug: "tiendas-en-linea",
      type: "ecommerce",
      logoInitial: "E",
      es: {
        name: "Tiendas en Línea",
        tagline: "Vende en línea sin fricción",
        description: "E-commerce completo con pasarela de pago, gestión de inventario y una experiencia de compra optimizada para convertir visitantes en clientes.",
        keyFeatures: "Pasarela de pagos · Gestión de inventario · Checkout optimizado · Integración con envíos"
      },
      en: {
        name: "Online Stores",
        tagline: "Sell online without friction",
        description: "Complete e-commerce with payment gateway, inventory management, and a shopping experience optimized to turn visitors into customers.",
        keyFeatures: "Payment gateway · Inventory management · Optimized checkout · Shipping integrations"
      }
    },
    {
      id: 5,
      slug: "software-a-medida",
      type: "software",
      logoInitial: "S",
      es: {
        name: "Software a Medida",
        tagline: "Cuando una plantilla no alcanza",
        description: "Desarrollo de software personalizado para automatizar procesos, integrar sistemas o construir el producto digital que tu negocio necesita desde cero.",
        keyFeatures: "Arquitectura a medida · Integraciones vía API · Automatización de procesos · Pensado para escalar"
      },
      en: {
        name: "Custom Software",
        tagline: "When a template isn't enough",
        description: "Custom software development to automate processes, integrate systems, or build the digital product your business needs from the ground up.",
        keyFeatures: "Custom architecture · API integrations · Process automation · Built to scale"
      }
    },
    {
      id: 6,
      slug: "branding-identidad-digital",
      type: "branding",
      logoInitial: "B",
      es: {
        name: "Branding e Identidad Digital",
        tagline: "Una marca que se ve tan bien como funciona",
        description: "Diseño de identidad visual, logotipo, sistema de marca y guía de estilo — la base visual sobre la que construimos cada proyecto digital.",
        keyFeatures: "Logotipo y sistema de marca · Paleta y tipografía · Guía de marca · Aplicaciones de marca"
      },
      en: {
        name: "Branding & Digital Identity",
        tagline: "A brand that looks as good as it works",
        description: "Visual identity design, logo, brand system, and style guide — the visual foundation every digital project is built on.",
        keyFeatures: "Logo & brand system · Color palette & typography · Brand guidelines · Brand applications"
      }
    }
  ],

  news: [
    {
      id: 1,
      slug: "oca-lanza-servicio-de-software-a-medida",
      category: "milestone",
      date: "2026-08-14",
      es: {
        title: "OCA Holding Group LLC amplía su oferta con software a medida",
        excerpt: "El equipo suma desarrollo de software personalizado a su catálogo de servicios digitales.",
        body: "OCA Holding Group LLC anunció la ampliación de su oferta de servicios para incluir desarrollo de software a medida, dirigido a empresas que necesitan automatizar procesos internos o integrar sistemas que no resuelven las herramientas genéricas del mercado. Esta ampliación responde a la demanda creciente de clientes que ya trabajaban con el equipo en sitios web y aplicaciones."
      },
      en: {
        title: "OCA Holding Group LLC Expands Into Custom Software",
        excerpt: "The team adds custom software development to its digital services catalog.",
        body: "OCA Holding Group LLC announced the expansion of its service offering to include custom software development, aimed at companies that need to automate internal processes or integrate systems that off-the-shelf tools can't solve. This expansion responds to growing demand from clients already working with the team on websites and applications."
      }
    },
    {
      id: 2,
      slug: "oca-entrega-tienda-en-linea-para-cliente-retail",
      category: "milestone",
      date: "2026-06-02",
      es: {
        title: "OCA entrega una nueva tienda en línea para un cliente de retail",
        excerpt: "Proyecto de e-commerce completo, desde el diseño de marca hasta el checkout.",
        body: "El equipo de OCA Holding Group LLC completó el desarrollo de una tienda en línea end-to-end para un cliente del sector retail, incluyendo diseño de marca, catálogo de productos, pasarela de pagos e integración con logística de envíos. El proyecto se entregó dentro del plazo acordado con el cliente."
      },
      en: {
        title: "OCA Delivers a New Online Store for a Retail Client",
        excerpt: "A full e-commerce project, from brand design through checkout.",
        body: "The OCA Holding Group LLC team completed an end-to-end online store build for a retail-sector client, including brand design, product catalog, payment gateway, and shipping/logistics integration. The project was delivered within the agreed timeline."
      }
    },
    {
      id: 3,
      slug: "oca-abre-portal-de-clientes",
      category: "press",
      date: "2026-03-20",
      es: {
        title: "OCA Holding Group LLC abre su portal de clientes",
        excerpt: "Los clientes ya pueden seguir el avance de su proyecto y gestionar pagos desde un panel dedicado.",
        body: "OCA Holding Group LLC puso en marcha su portal de clientes, donde cada cliente puede iniciar sesión para ver el estado de su proyecto, la bitácora de avances publicada por el equipo, y gestionar el pago de facturas de forma segura."
      },
      en: {
        title: "OCA Holding Group LLC Launches Its Client Portal",
        excerpt: "Clients can now track their project's progress and manage payments from a dedicated dashboard.",
        body: "OCA Holding Group LLC launched its client portal, where each client can sign in to see their project's status, the progress log posted by the team, and securely manage invoice payments."
      }
    }
  ]
};

window.OCA_DATA = OCA_DATA;
