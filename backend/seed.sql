INSERT INTO Categories VALUES
  (1, 'Concerts & Music'),
  (4, 'Career & Academic');

INSERT INTO Venues VALUES
  (1, 'Shea Center for Performing Arts', '300 Pompton Rd', 'Wayne', 'NJ', 900),
  (2, 'University Commons Ballroom', '300 Pompton Rd', 'Wayne', 'NJ', 400);

INSERT INTO Events VALUES
  (3, 2, 2, 4, 'Winter Career Fair', 'Meet employers hiring WPU students. Bring your resume.',
    '2026-12-02', '11:00', NULL, 'Active'),
  (5, 2, 1, 1, 'Student Band Showcase', 'Six student bands, one night.',
    '2026-12-06', '19:00', NULL, 'Active');

INSERT INTO TicketTypes VALUES
  (4, 3, 'Student', 0, 400, 399),
  (6, 5, 'Student', 500, 800, 798),
  (7, 5, 'VIP', 1500, 10, 10);
