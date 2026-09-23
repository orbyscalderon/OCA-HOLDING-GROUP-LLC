/**
 * OCA Holding Group LLC — Datos estructurados del sitio
 * ------------------------------------------------------
 * INTEGRACIÓN CMS / BASE DE DATOS: estos arreglos simulan las tablas
 * `companies` y (para noticias) una tabla `news_posts` del backend.
 * En producción, reemplazar OCA_DATA.companies y OCA_DATA.news por el
 * resultado de fetch('/api/companies') y fetch('/api/news') respectivamente,
 * manteniendo la misma forma de objeto (id, slug, sector, es{...}, en{...}).
 * Ver /backend/schema.sql para la estructura de base de datos sugerida.
 */
const OCA_DATA = {
  companies: [
    {
      id: 1,
      slug: "orbis-digital-systems",
      sector: "technology",
      logoInitial: "O",
      website: "https://example.com/orbis-digital",
      joinedYear: 2018,
      es: {
        name: "Orbis Digital Systems",
        tagline: "Software empresarial e inteligencia artificial aplicada",
        description: "Desarrolla plataformas de software a medida, automatización de procesos e inteligencia artificial aplicada para clientes corporativos en América y Europa."
      },
      en: {
        name: "Orbis Digital Systems",
        tagline: "Enterprise software and applied artificial intelligence",
        description: "Develops custom software platforms, process automation, and applied artificial intelligence for corporate clients across the Americas and Europe."
      }
    },
    {
      id: 2,
      slug: "meridian-properties-group",
      sector: "realestate",
      logoInitial: "M",
      website: "https://example.com/meridian-properties",
      joinedYear: 2016,
      es: {
        name: "Meridian Properties Group",
        tagline: "Desarrollo e inversión inmobiliaria comercial y residencial",
        description: "Desarrolla, adquiere y administra activos inmobiliarios comerciales y residenciales de alto valor en mercados urbanos estratégicos."
      },
      en: {
        name: "Meridian Properties Group",
        tagline: "Commercial and residential real estate development and investment",
        description: "Develops, acquires, and manages high-value commercial and residential real estate assets in strategic urban markets."
      }
    },
    {
      id: 3,
      slug: "vantage-business-solutions",
      sector: "services",
      logoInitial: "V",
      website: "https://example.com/vantage-solutions",
      joinedYear: 2019,
      es: {
        name: "Vantage Business Solutions",
        tagline: "Consultoría estratégica y servicios profesionales",
        description: "Ofrece consultoría estratégica, servicios de outsourcing administrativo y soluciones de eficiencia operativa a empresas medianas y grandes."
      },
      en: {
        name: "Vantage Business Solutions",
        tagline: "Strategic consulting and professional services",
        description: "Provides strategic consulting, administrative outsourcing services, and operational efficiency solutions to mid-size and large enterprises."
      }
    },
    {
      id: 4,
      slug: "lumina-entertainment-group",
      sector: "entertainment",
      logoInitial: "L",
      website: "https://example.com/lumina-entertainment",
      joinedYear: 2021,
      es: {
        name: "Lumina Entertainment Group",
        tagline: "Producción audiovisual y experiencias en vivo",
        description: "Produce contenido audiovisual, gestiona eventos en vivo y desarrolla propiedades de entretenimiento con distribución en múltiples plataformas."
      },
      en: {
        name: "Lumina Entertainment Group",
        tagline: "Audiovisual production and live experiences",
        description: "Produces audiovisual content, manages live events, and develops entertainment properties distributed across multiple platforms."
      }
    },
    {
      id: 5,
      slug: "solara-energy-holdings",
      sector: "energy",
      logoInitial: "S",
      website: "https://example.com/solara-energy",
      joinedYear: 2022,
      es: {
        name: "Solara Energy Holdings",
        tagline: "Energía renovable e infraestructura sostenible",
        description: "Desarrolla y opera proyectos de energía solar y eólica a escala comercial, además de infraestructura de almacenamiento energético."
      },
      en: {
        name: "Solara Energy Holdings",
        tagline: "Renewable energy and sustainable infrastructure",
        description: "Develops and operates commercial-scale solar and wind energy projects, along with energy storage infrastructure."
      }
    },
    {
      id: 6,
      slug: "capital-bridge-partners",
      sector: "finance",
      logoInitial: "C",
      website: "https://example.com/capital-bridge",
      joinedYear: 2017,
      es: {
        name: "Capital Bridge Partners",
        tagline: "Asesoría financiera y estructuración de capital",
        description: "Brinda asesoría en fusiones y adquisiciones, estructuración de deuda y levantamiento de capital para empresas en crecimiento."
      },
      en: {
        name: "Capital Bridge Partners",
        tagline: "Financial advisory and capital structuring",
        description: "Provides mergers and acquisitions advisory, debt structuring, and capital raising services for growth-stage companies."
      }
    }
  ],

  news: [
    {
      id: 1,
      slug: "oca-adquiere-solara-energy-holdings",
      category: "acquisition",
      date: "2026-08-14",
      es: {
        title: "OCA Holding Group LLC adquiere participación mayoritaria en Solara Energy Holdings",
        excerpt: "La operación fortalece la presencia del grupo en el sector de energías renovables en América Latina y el Caribe.",
        body: "OCA Holding Group LLC anunció la adquisición de una participación mayoritaria en Solara Energy Holdings, empresa especializada en el desarrollo de proyectos solares y eólicos a escala comercial. Esta operación se enmarca en la estrategia del grupo de diversificar su portafolio hacia sectores con alto potencial de crecimiento sostenible y alineados con criterios ambientales, sociales y de gobernanza (ESG)."
      },
      en: {
        title: "OCA Holding Group LLC Acquires Majority Stake in Solara Energy Holdings",
        excerpt: "The transaction strengthens the group's presence in the renewable energy sector across Latin America and the Caribbean.",
        body: "OCA Holding Group LLC announced the acquisition of a majority stake in Solara Energy Holdings, a company specializing in commercial-scale solar and wind project development. The transaction is part of the group's strategy to diversify its portfolio into sectors with strong sustainable growth potential, aligned with environmental, social, and governance (ESG) criteria."
      }
    },
    {
      id: 2,
      slug: "lumina-entertainment-expande-operaciones",
      category: "milestone",
      date: "2026-06-02",
      es: {
        title: "Lumina Entertainment Group expande operaciones a tres nuevos mercados",
        excerpt: "La filial de entretenimiento del grupo consolida su crecimiento internacional con nuevas oficinas de producción.",
        body: "Lumina Entertainment Group, filial de OCA Holding Group LLC, anunció la apertura de nuevas oficinas de producción en tres mercados internacionales, como parte de su plan de expansión de contenido audiovisual y experiencias en vivo. Este hito refuerza la estrategia del holding de fortalecer marcas con capacidad de escalar globalmente."
      },
      en: {
        title: "Lumina Entertainment Group Expands Operations to Three New Markets",
        excerpt: "The group's entertainment subsidiary consolidates its international growth with new production offices.",
        body: "Lumina Entertainment Group, a subsidiary of OCA Holding Group LLC, announced the opening of new production offices in three international markets as part of its expansion plan for audiovisual content and live experiences. This milestone reinforces the holding's strategy of strengthening brands with the capacity to scale globally."
      }
    },
    {
      id: 3,
      slug: "oca-publica-informe-anual-gobierno-corporativo",
      category: "press",
      date: "2026-03-20",
      es: {
        title: "OCA Holding Group LLC publica su Informe Anual de Gobierno Corporativo",
        excerpt: "El informe detalla los avances del grupo en materia de cumplimiento, auditoría y sostenibilidad durante el ejercicio anterior.",
        body: "OCA Holding Group LLC publicó su Informe Anual de Gobierno Corporativo, documento que resume los avances alcanzados en materia de cumplimiento normativo, auditoría independiente y criterios ESG en todas sus filiales. El informe está disponible para inversionistas y socios estratégicos que lo soliciten a través del departamento de Relación con Inversionistas."
      },
      en: {
        title: "OCA Holding Group LLC Releases Its Annual Corporate Governance Report",
        excerpt: "The report details the group's progress on compliance, auditing, and sustainability over the past fiscal year.",
        body: "OCA Holding Group LLC released its Annual Corporate Governance Report, summarizing progress achieved in regulatory compliance, independent auditing, and ESG criteria across all subsidiaries. The report is available to investors and strategic partners upon request through the Investor Relations department."
      }
    },
    {
      id: 4,
      slug: "vantage-business-solutions-alianza-tecnologica",
      category: "press",
      date: "2026-01-11",
      es: {
        title: "Vantage Business Solutions firma alianza tecnológica para automatización de procesos",
        excerpt: "La alianza permitirá a Vantage ofrecer soluciones de automatización más robustas a sus clientes corporativos.",
        body: "Vantage Business Solutions, filial de servicios profesionales de OCA Holding Group LLC, formalizó una alianza tecnológica orientada a robustecer su oferta de automatización de procesos administrativos, en línea con la apuesta del holding por la innovación con propósito."
      },
      en: {
        title: "Vantage Business Solutions Signs Technology Partnership for Process Automation",
        excerpt: "The partnership will allow Vantage to offer more robust automation solutions to its corporate clients.",
        body: "Vantage Business Solutions, the professional services subsidiary of OCA Holding Group LLC, formalized a technology partnership aimed at strengthening its administrative process automation offering, in line with the holding's commitment to purpose-driven innovation."
      }
    }
  ]
};

window.OCA_DATA = OCA_DATA;
