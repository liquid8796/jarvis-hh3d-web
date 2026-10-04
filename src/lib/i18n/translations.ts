export type SupportedLanguage = "en" | "vi";

export interface LandingTranslations {
  nav: {
    domains: string;
    signIn: string;
    register: string;
    profile: string;
    sectAdmin: string;
    auto: string;
    queue: string;
    chat: string;
    signOut: string;
  };
  hero: {
    headlinePre: string;
    headlineHighlight1: string;
    headlineMid: string;
    headlineHighlight2: string;
    description: string;
    ctaPrimary: string;
    ctaSecondary: string;
  };
  pillars: Array<{
    title: string;
    body: string;
  }>;
  features: {
    tag: string;
    heading: string;
    description: string;
    items: Array<{
      title: string;
      body: string;
    }>;
  };
  steps: {
    tag: string;
    heading: string;
    stepPrefix: string;
    items: Array<{
      title: string;
      body: string;
    }>;
  };
  faq: {
    tag: string;
    heading: string;
    description: string;
    items: Array<{
      question: string;
      answer: string;
    }>;
  };
  cta: {
    heading: string;
    description: string;
    buttonRegister: string;
    buttonPrivacy: string;
  };
  footer: {
    rights: string;
    privacy: string;
  };
}

export const TRANSLATIONS: Record<SupportedLanguage, LandingTranslations> = {
  en: {
    nav: {
      domains: "Domains",
      signIn: "Sign In",
      register: "Register",
      profile: "Profile",
      sectAdmin: "Sect Admin",
      auto: "Automation",
      queue: "Task Queue",
      chat: "Chat Room",
      signOut: "Sign Out",
    },
    hero: {
      headlinePre: "Even ",
      headlineHighlight1: "mortals",
      headlineMid: " can ascend through ",
      headlineHighlight2: "smart automation",
      description:
        "Auto HH3D puts your daily hoathinh3d tasks on the cloud. Configure once, run in one click, and let 24/7 background workers handle the daily chores while you collect the rewards.",
      ctaPrimary: "Join the Sect",
      ctaSecondary: "I Have an Account",
    },
    pillars: [
      {
        title: "Cloud Automation",
        body: "Launch tasks with a single click. Cloud workers take over your daily quests — close your browser or turn off your computer, the process keeps running.",
      },
      {
        title: "Sect Discipline",
        body: "Registration is just the start. The Sect Master reviews each applicant to keep the platform secure, fair, and abuse-free.",
      },
      {
        title: "Readable Activity Logs",
        body: "Clear, step-by-step logs for every run: rooms joined, users expelled, rewards earned — recorded line by line in real time.",
      },
    ],
    features: {
      tag: "Automated Artifacts",
      heading: "Features Built for Everyday Cultivators",
      description:
        "Designed specifically to cut down your daily chore time on hoathinh3d while keeping your account secure, fair, and transparent.",
      items: [
        {
          title: "Hands-Free Daily Tasks",
          body: "Daily check-ins, quizzes, rituals, and seasonal bonus chests run on your set schedule — never miss a day even when life gets busy.",
        },
        {
          title: "Cloud-Based, No PC Required",
          body: "Workers run on server nodes, not on your personal machine. Power outages, closed tabs, or spotty Wi-Fi won't interrupt your runs.",
        },
        {
          title: "Step-by-Step Transparency",
          body: "Plain-text logs show exactly what happened: rooms entered, rewards claimed, errors caught, and auto-recovery steps taken.",
        },
        {
          title: "Fair Queue for Everyone",
          body: "When multiple disciples run tasks simultaneously, jobs are queued in order with live positions and estimated wait times. No skipping.",
        },
        {
          title: "Vetted Membership",
          body: "New accounts are reviewed by administrators before gaining worker access. Role-based permissions keep the system stable.",
        },
        {
          title: "Privacy & Account Safety",
          body: "Passwords are one-way hashed, login sessions expire cleanly, and data is only used to run your tasks. Review our transparent privacy policy anytime.",
        },
      ],
    },
    steps: {
      tag: "Path to Cultivation",
      heading: "Four Steps to Get Started with Auto HH3D",
      stepPrefix: "Step",
      items: [
        {
          title: "Create an Account",
          body: "Choose your cultivator name and submit a registration request in seconds.",
        },
        {
          title: "Await Master Approval",
          body: "The Sect Master reviews your account and unlocks access to the automation altar.",
        },
        {
          title: "Configure Once",
          body: "Select which daily quests you want automated and pick your preferred schedule.",
        },
        {
          title: "One-Click Cultivation",
          body: "Hit start, let cloud workers do the heavy lifting, and reap your rewards.",
        },
      ],
    },
    faq: {
      tag: "Common Questions",
      heading: "Frequently Asked Questions",
      description:
        "Direct answers about how our cloud workers operate, account safety, and daily usage.",
      items: [
        {
          question: "What is Auto HH3D?",
          answer:
            "Auto HH3D is an automation platform for hoathinh3d daily quests. You configure your tasks once, and background workers run them on the cloud, keeping detailed real-time logs.",
        },
        {
          question: "Do I need to leave my PC on or keep the browser open?",
          answer:
            "No. The automation runs entirely on cloud server nodes. Once launched, you can close your browser or shut down your PC — tasks run until completed.",
        },
        {
          question: "How do I start using it?",
          answer:
            "Click 'Join the Sect' to register an account, wait for admin approval, then head to the Automation page to set up your tasks and run. The whole setup takes just minutes.",
        },
        {
          question: "Where can I monitor task progress?",
          answer:
            "The Automation page streams live status line by line. The Task Queue shows your position and estimated wait time when server demand is high.",
        },
        {
          question: "Is my account information secure?",
          answer:
            "Yes. Passwords are securely hashed and never stored in readable text. Data is used strictly for operating your automation runs, as detailed in our Privacy Policy.",
        },
        {
          question: "What does 'Sect Seclusion' (Bế Quan) mean?",
          answer:
            "When the altar is undergoing scheduled maintenance, upgrades, or database syncing, the system enters Seclusion mode to protect your ongoing runs from data conflicts.",
        },
      ],
    },
    cta: {
      heading: "Ready to automate your daily grind?",
      description:
        "Create an account today to join the sect and put your daily hoathinh3d quests on autopilot.",
      buttonRegister: "Join the Sect",
      buttonPrivacy: "Privacy Policy",
    },
    footer: {
      rights: "© 2026 Nam Cung Binh. All rights reserved.",
      privacy: "Privacy Policy",
    },
  },
  vi: {
    nav: {
      domains: "Tên Miền",
      signIn: "Nhập Môn",
      register: "Bái Sư",
      profile: "Hồ Sơ",
      sectAdmin: "Tông Môn",
      auto: "Auto",
      queue: "Hàng Đợi",
      chat: "Phòng Chat",
      signOut: "Xuất Quan",
    },
    hero: {
      headlinePre: "",
      headlineHighlight1: "Phàm nhân",
      headlineMid: " cũng có thể ",
      headlineHighlight2: "tu tiên bằng automation",
      description:
        "Auto HH3D đưa cỗ máy nhiệm vụ ngày của hoathinh3d lên mây: cấu hình một lần, khai đàn một chạm, khôi lỗi trên server lo phần cày cuốc — đạo hữu chỉ việc thu linh thạch.",
      ctaPrimary: "Bái Sư Nhập Môn",
      ctaSecondary: "Đã có đạo hiệu",
    },
    pillars: [
      {
        title: "Khai Đàn Viễn Trình",
        body: "Bấm một nút trên Tế đàn, khôi lỗi trên server tự vận hành nhiệm vụ ngày — đóng trình duyệt, tắt máy, đàn pháp vẫn chạy.",
      },
      {
        title: "Tông Môn Nghiêm Cẩn",
        body: "Bái sư là bước đầu; trưởng môn duyệt danh sách môn đồ, ai được phép khai đàn do tông môn quyết.",
      },
      {
        title: "Nhật Ký Tu Luyện",
        body: "Mọi lượt chạy log bằng ngôn ngữ nhân tộc: ai vào phòng, trục xuất ai, huyền tinh thu về bao nhiêu — từng dòng, từng thời khắc.",
      },
    ],
    features: {
      tag: "Pháp bảo tự động",
      heading: "Tính năng linh đài phục vụ tu sĩ",
      description:
        "Mọi tính năng được thiết kế riêng cho việc tối ưu thời gian thực hiện nhiệm vụ ngày trên hoathinh3d, bảo đảm công bằng, minh bạch và an toàn tài khoản.",
      items: [
        {
          title: "Nhiệm vụ ngày tự vận hành",
          body: "Điểm danh, vấn đáp, tế lễ, phúc lợi và các nhiệm vụ lặp lại mỗi ngày được khôi lỗi xử lý theo lịch bạn đặt — không bỏ sót một lượt nào kể cả khi bạn bận.",
        },
        {
          title: "Chạy trên server, không treo máy",
          body: "Khôi lỗi sống trên máy chủ đám mây chứ không trên máy tính của bạn. Tắt trình duyệt, tắt máy, mất điện ở nhà — đàn pháp vẫn chạy đến khi xong việc.",
        },
        {
          title: "Nhật ký minh bạch từng dòng",
          body: "Mỗi lượt chạy để lại nhật ký bằng tiếng Việt dễ hiểu: vào phòng nào, nhận thưởng gì, gặp lỗi ở đâu và đã tự phục hồi ra sao — bạn luôn biết tài khoản mình đang làm gì.",
        },
        {
          title: "Hàng đợi công bằng cho cả tông môn",
          body: "Nhiều đạo hữu cùng khai đàn sẽ được xếp hàng theo thứ tự rõ ràng, hiển thị vị trí và thời gian chờ ước tính, không ai chen ngang, không lượt nào bị thất lạc.",
        },
        {
          title: "Duyệt môn đồ chặt chẽ",
          body: "Tài khoản mới phải được trưởng môn duyệt mới được dùng khôi lỗi. Quyền hạn được phân theo vai trò để cỗ máy chỉ phục vụ đúng người, đúng việc.",
        },
        {
          title: "Bảo mật và riêng tư",
          body: "Mật khẩu được băm một chiều, phiên đăng nhập có hạn dùng, dữ liệu chỉ phục vụ vận hành. Chính sách quyền riêng tư công khai cách hệ thống và đối tác quảng cáo xử lý dữ liệu.",
        },
      ],
    },
    steps: {
      tag: "Lộ trình tu tập",
      heading: "Bốn bước bắt đầu cùng Auto HH3D",
      stepPrefix: "Bước",
      items: [
        {
          title: "Bái sư nhập môn",
          body: "Tạo đạo hiệu và gửi yêu cầu gia nhập tông môn chỉ trong vài giây.",
        },
        {
          title: "Chờ trưởng môn duyệt",
          body: "Trưởng môn xét duyệt và cấp quyền sử dụng khôi lỗi cho tài khoản của bạn.",
        },
        {
          title: "Cấu hình một lần",
          body: "Chọn nhiệm vụ muốn tự động hoá và khung giờ chạy phù hợp với lịch của bạn.",
        },
        {
          title: "Khai đàn một chạm",
          body: "Bấm khai đàn, khôi lỗi nhận việc trên server — bạn chỉ việc thu linh thạch.",
        },
      ],
    },
    faq: {
      tag: "Hỏi đáp tu luyện",
      heading: "Câu hỏi thường gặp",
      description:
        "Giải đáp các thắc mắc phổ biến về cơ chế hoạt động, độ an toàn và cách vận hành khôi lỗi.",
      items: [
        {
          question: "Auto HH3D là gì?",
          answer:
            "Auto HH3D là nền tảng tự động hoá nhiệm vụ ngày cho hoathinh3d. Bạn cấu hình nhiệm vụ một lần, sau đó khôi lỗi chạy trên server sẽ thay bạn hoàn thành các việc lặp lại hằng ngày và ghi lại nhật ký chi tiết.",
        },
        {
          question: "Tôi có cần mở máy tính hoặc treo trình duyệt không?",
          answer:
            "Không. Khôi lỗi chạy hoàn toàn trên máy chủ đám mây. Sau khi khai đàn, bạn có thể tắt trình duyệt hoặc tắt máy, nhiệm vụ vẫn tiếp tục chạy cho đến khi hoàn thành.",
        },
        {
          question: "Làm sao để bắt đầu sử dụng?",
          answer:
            "Bấm Bái Sư Nhập Môn để tạo tài khoản, chờ trưởng môn duyệt, rồi vào trang Auto để chọn nhiệm vụ và khai đàn. Toàn bộ quá trình chỉ mất vài phút.",
        },
        {
          question: "Tôi theo dõi tiến độ khôi lỗi ở đâu?",
          answer:
            "Trang Auto hiển thị trạng thái từng lượt chạy theo thời gian thực, còn Hàng Đợi Công Việc cho biết vị trí của bạn và thời gian chờ ước tính khi tông môn đông người.",
        },
        {
          question: "Dữ liệu tài khoản của tôi có an toàn không?",
          answer:
            "Mật khẩu được băm một chiều và không bao giờ lưu dạng đọc được. Dữ liệu chỉ dùng để vận hành dịch vụ. Chi tiết cách xử lý dữ liệu và cookie quảng cáo được công khai tại trang Quyền riêng tư.",
        },
        {
          question: "Bế quan trùng tu nghĩa là gì?",
          answer:
            "Khi đàn pháp cần bảo trì, cập nhật mã nguồn hoặc đồng bộ cơ sở dữ liệu, hệ thống tạm thời bế quan để tránh xung đột dữ liệu và bảo toàn lượt chạy cho bạn.",
        },
      ],
    },
    cta: {
      heading: "Sẵn sàng giải phóng thời gian của bạn?",
      description:
        "Tạo tài khoản ngay hôm nay để gia nhập tông môn và trải nghiệm cỗ máy tự động hoá nhiệm vụ ngày chạy trên đám mây.",
      buttonRegister: "Bái Sư Nhập Môn",
      buttonPrivacy: "Chính sách bảo mật",
    },
    footer: {
      rights: "© 2026 Nam Cung Bình. All rights reserved.",
      privacy: "Quyền riêng tư",
    },
  },
};
