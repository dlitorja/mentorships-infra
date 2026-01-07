-- Insert Kajabi offer mappings for instructor inventory tracking
-- All these are one-on-one offers based on the instructor data

INSERT INTO kajabi_offer_mappings (offer_id, instructor_slug, mentorship_type, kajabi_offer_url) VALUES
-- Neil Gray
('ADNkiMXF', 'neil-gray', 'one-on-one', 'https://home.huckleberry.art/offers/ADNkiMXF/checkout'),
('NTLKLf3F', 'neil-gray', 'one-on-one', 'https://home.huckleberry.art/offers/NTLKLf3F/checkout'),

-- Andrea Sipl
('Z46Axcmq', 'andrea-sipl', 'one-on-one', 'https://home.huckleberry.art/offers/Z46Axcmq/checkout'),

-- Ash Kirk
('kNfA7gtX', 'ash-kirk', 'one-on-one', 'https://home.huckleberry.art/offers/kNfA7gtX/checkout'),

-- Oliver Titley
('AszD8huP', 'oliver-titley', 'one-on-one', 'https://home.huckleberry.art/offers/AszD8huP/checkout'),
('iSLmoxMk', 'oliver-titley', 'one-on-one', 'https://home.huckleberry.art/offers/iSLmoxMk/checkout'),

-- Rakasa
('GgkFAbpC', 'rakasa', 'one-on-one', 'https://home.huckleberry.art/offers/GgkFAbpC/checkout'),
-- Rakasa group offer not yet available (placeholder URL)

-- Nino Vecia
('shmUAkoC', 'nino-vecia', 'one-on-one', 'https://home.huckleberry.art/offers/shmUAkoC/checkout'),

-- Keven Mallqui
('SZrKzyoT', 'keven-mallqui', 'one-on-one', 'https://home.huckleberry.art/offers/SZrKzyoT/checkout'),

-- Kimea Zizzari
('nTDoD9XK', 'kimea-zizzari', 'one-on-one', 'https://home.huckleberry.art/offers/nTDoD9XK/checkout'),

-- Jordan Jardine
('qbekGLEo', 'jordan-jardine', 'one-on-one', 'https://home.huckleberry.art/offers/qbekGLEo/checkout'),

-- Malina Dowling
('rEA23xnk', 'malina-dowling', 'one-on-one', 'https://home.huckleberry.art/offers/rEA23xnk/checkout'),

-- Cameron Nissen
('xGKxSVJL', 'cameron-nissen', 'one-on-one', 'https://home.huckleberry.art/offers/xGKxSVJL/checkout'),

-- Amanda Kiefer
('caWkx6z7', 'amanda-kiefer', 'one-on-one', 'https://home.huckleberry.art/offers/caWkx6z7/checkout')

ON CONFLICT (offer_id) DO NOTHING;
