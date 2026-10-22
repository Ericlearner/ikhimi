import UIKit

/// No internet: says so in the person's language, with a button to try again (pulling down works too)
final class OfflineView: UIView {
    var onRetry: (() -> Void)?

    override init(frame: CGRect) {
        super.init(frame: frame)
        backgroundColor = UIColor(named: "Paper") ?? .systemBackground

        let icon = UIImageView(image: UIImage(systemName: "wifi.slash", withConfiguration: UIImage.SymbolConfiguration(pointSize: 44, weight: .regular)))
        icon.tintColor = .secondaryLabel

        let title = UILabel()
        title.text = L("offline.title")
        title.font = UIFont.preferredFont(forTextStyle: .title2).withTraits(.traitBold)
        title.adjustsFontForContentSizeCategory = true
        title.textAlignment = .center
        title.numberOfLines = 0

        let body = UILabel()
        body.text = L("offline.body")
        body.font = UIFont.preferredFont(forTextStyle: .body)
        body.adjustsFontForContentSizeCategory = true
        body.textColor = .secondaryLabel
        body.textAlignment = .center
        body.numberOfLines = 0

        var button = UIButton.Configuration.filled()
        button.title = L("offline.retry")
        button.baseBackgroundColor = UIColor(named: "AccentColor")
        button.baseForegroundColor = UIColor(red: 0.173, green: 0.243, blue: 0.314, alpha: 1)
        button.cornerStyle = .large
        button.buttonSize = .large
        let retry = UIButton(configuration: button, primaryAction: UIAction { [weak self] _ in self?.onRetry?() })

        let stack = UIStackView(arrangedSubviews: [icon, title, body, retry])
        stack.axis = .vertical
        stack.alignment = .center
        stack.spacing = 12
        stack.setCustomSpacing(24, after: body)
        stack.translatesAutoresizingMaskIntoConstraints = false
        addSubview(stack)
        NSLayoutConstraint.activate([
            stack.centerYAnchor.constraint(equalTo: safeAreaLayoutGuide.centerYAnchor),
            stack.leadingAnchor.constraint(equalTo: safeAreaLayoutGuide.leadingAnchor, constant: 32),
            stack.trailingAnchor.constraint(equalTo: safeAreaLayoutGuide.trailingAnchor, constant: -32),
        ])
    }

    @available(*, unavailable)
    required init?(coder: NSCoder) {
        fatalError("init(coder:) is not used")
    }
}

private extension UIFont {
    func withTraits(_ traits: UIFontDescriptor.SymbolicTraits) -> UIFont {
        guard let descriptor = fontDescriptor.withSymbolicTraits(traits) else { return self }
        return UIFont(descriptor: descriptor, size: 0)
    }
}
